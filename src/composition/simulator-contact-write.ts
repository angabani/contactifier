import * as Device from 'expo-device';
import { getPermissionsAsync } from 'expo-contacts';
import { Platform } from 'react-native';

import {
  ContactWriteCapabilityGate,
  ExecuteContactWritePlan,
  prepareContactTransactionUndo,
  prepareContactBackupRestore,
  ReconcileUnknownContactWrite,
  ResumeContactWriteVerification,
  ResumeContactWriteFinalization,
  type ContactWriterCertification,
} from '@/application';
import {
  transitionCleanupWorkflow,
  contactsSemanticallyEqual,
  type BackupManifest,
  type CleanupWorkflow,
  type ContactSnapshot,
  type CanonicalContact,
} from '@/domain';
import { assertSimulatorFixtureWritePlan } from '@/features/developer/simulator-fixture-write-policy';
import { reconcileSimulatorFixtureRestoreIdentity } from '@/features/developer/simulator-fixture-restore-identity';
import { ExpoIosContactWriter } from '@/infrastructure/contacts/expo/expo-ios-contact-writer';
import { SystemClock } from '@/infrastructure/system/system-clock';
import {
  createPerChangeCleanupWorkflows,
  manageCleanupWorkflow,
  workflowRepository as repository,
} from './cleanup-workflow';
import { loadContactBackup } from './contact-backup';
import { readDeviceContacts } from './device-contact-scan';

const ADAPTER_ID = 'contactifier.expo-ios-writer.simulator-fixtures.v1';
const certification: ContactWriterCertification = Object.freeze({
  adapterId: ADAPTER_ID,
  platform: 'ios',
  contractVersion: 1,
  enabled: true,
  certifiedAt: '2026-08-20T00:00:00.000Z',
  evidence: Object.freeze({
    adapterContract: true,
    backupRestore: true,
    integrationTests: true,
    permissionHandling: true,
    postWriteVerification: true,
    reconciliation: true,
    rollback: true,
  }),
});

const clock = new SystemClock();
const writer = new ExpoIosContactWriter();
const executor = new ExecuteContactWritePlan(repository, writer, writer, clock, ADAPTER_ID);
const reconciler = new ReconcileUnknownContactWrite(repository, writer, writer, clock);
const verificationResumer = new ResumeContactWriteVerification(repository, writer, writer, clock, ADAPTER_ID);
const finalizationResumer = new ResumeContactWriteFinalization(repository, writer, clock, ADAPTER_ID);
const gate = new ContactWriteCapabilityGate();

async function reconcileRestoredContactIdentities(
  backupSnapshot: ContactSnapshot,
  currentSnapshot: ContactSnapshot,
): Promise<{
  readonly sourceAliases: ReadonlyMap<string, string>;
  readonly derivedContactsToDelete: readonly CanonicalContact[];
}> {
  const currentBySourceId = new Map(
    currentSnapshot.contacts.map((contact) => [contact.recordRef.sourceContactId, contact]),
  );
  const derived = new Map<string, CanonicalContact>();
  const markerReconciliation = reconcileSimulatorFixtureRestoreIdentity(
    backupSnapshot.contacts,
    currentSnapshot.contacts,
  );
  const aliases = new Map(markerReconciliation.sourceAliases);
  for (const contact of markerReconciliation.redundantContacts) {
    derived.set(contact.recordRef.sourceContactId, contact);
  }
  const backupSourceIds = new Set(
    backupSnapshot.contacts.map(({ recordRef }) => recordRef.sourceContactId),
  );
  const restoredCandidates = new Map<string, {
    readonly current: CanonicalContact;
    readonly updatedAt: string;
  }[]>();
  for (const summary of await manageCleanupWorkflow.listHistory()) {
    if (summary.phase !== 'completed') continue;
    const workflow = await manageCleanupWorkflow.load(summary.id);
    if (!workflow?.writePlan || workflow.changeSet.id.includes(':undo:transaction:')) continue;
    for (const operation of workflow.writePlan.operations) {
      if (operation.kind !== 'create') continue;
      const receipt = workflow.journal.find(
        (entry) => entry.operationId === operation.id && entry.outcome === 'applied' && entry.receipt,
      )?.receipt;
      if (!receipt) continue;
      const current = currentBySourceId.get(receipt.sourceContactId);
      if (!current || !contactsSemanticallyEqual(current, operation.contact)) continue;
      if (workflow.changeSet.id.includes(':restore:')) {
        const backupSourceId = operation.contact.recordRef.sourceContactId;
        const candidates = restoredCandidates.get(backupSourceId) ?? [];
        candidates.push({ current, updatedAt: workflow.updatedAt });
        restoredCandidates.set(backupSourceId, candidates);
      } else {
        if (!backupSourceIds.has(receipt.sourceContactId)) {
          derived.set(receipt.sourceContactId, current);
        }
      }
    }
  }
  for (const [backupSourceId, candidates] of restoredCandidates) {
    const ordered = [...candidates].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    if (!backupSourceIds.has(backupSourceId)) {
      for (const candidate of ordered) {
        derived.set(candidate.current.recordRef.sourceContactId, candidate.current);
      }
      continue;
    }
    const originalStillExists = currentBySourceId.has(backupSourceId);
    const markerKeeperSourceId = aliases.get(backupSourceId);
    const keeper = originalStillExists
      ? undefined
      : ordered.find(({ current }) => current.recordRef.sourceContactId === markerKeeperSourceId)
        ?? (markerKeeperSourceId ? undefined : ordered[0]);
    if (keeper && !markerKeeperSourceId) {
      aliases.set(backupSourceId, keeper.current.recordRef.sourceContactId);
    }
    for (const candidate of ordered) {
      if (candidate !== keeper) {
        derived.set(candidate.current.recordRef.sourceContactId, candidate.current);
      }
    }
  }
  for (const keeperSourceId of aliases.values()) derived.delete(keeperSourceId);
  return Object.freeze({
    sourceAliases: aliases,
    derivedContactsToDelete: Object.freeze([...derived.values()]),
  });
}

export async function previewSimulatorFixtureBackupRestore(manifest: BackupManifest) {
  const [backupSnapshot, currentSnapshot] = await Promise.all([
    loadContactBackup.execute(manifest),
    readDeviceContacts.execute({ source: manifest.source }),
  ]);
  const reconciliation = await reconcileRestoredContactIdentities(
    backupSnapshot,
    currentSnapshot,
  );
  return Object.freeze({
    backupSnapshot,
    currentSnapshot,
    ...reconciliation,
  });
}

export async function executeSimulatorFixtureWrite(
  workflow: CleanupWorkflow,
): Promise<CleanupWorkflow> {
  if (!__DEV__ || Platform.OS !== 'ios' || Device.isDevice) {
    throw new Error('Native fixture execution is restricted to the iOS Simulator.');
  }
  if (workflow.phase !== 'preflighted' || !workflow.writePlan) {
    throw new Error('A persisted preflight plan is required.');
  }
  assertSimulatorFixtureWritePlan(workflow.writePlan);
  const permission = await getPermissionsAsync();
  const fullContactAccess = permission.granted && permission.accessPrivileges === 'all';
  const authorization = gate.authorize({
    workflow,
    certification,
    runtime: {
      platform: 'ios',
      fullContactAccess,
      explicitUserConfirmation: true,
      verifiedBackupId: workflow.backupId,
      freshSnapshotId: workflow.writePlan.freshSnapshotId,
    },
    now: clock.now(),
  });
  return executor.execute(workflow, authorization);
}

export async function prepareAndExecuteSimulatorFixtureUndo(
  original: CleanupWorkflow,
  currentSnapshot: ContactSnapshot,
): Promise<CleanupWorkflow> {
  const plannedAt = clock.now().toISOString();
  const prepared = prepareContactTransactionUndo({
    workflow: original,
    currentSnapshot,
    plannedAt,
  });
  let undo = await manageCleanupWorkflow.start({
    source: original.source,
    snapshotId: currentSnapshot.id,
    backupId: original.backupId,
    changeSet: prepared.changeSet,
  });
  undo = await manageCleanupWorkflow.preflight(undo, prepared.writePlan);
  return executeSimulatorFixtureWrite(undo);
}

export async function restoreSimulatorFixtureBackup(
  manifest: BackupManifest,
): Promise<SimulatorTransactionBatchResult> {
  if (!__DEV__ || Platform.OS !== 'ios' || Device.isDevice) {
    throw new Error('Full backup restoration is restricted to the iOS Simulator.');
  }
  const { backupSnapshot, currentSnapshot, derivedContactsToDelete, sourceAliases } =
    await previewSimulatorFixtureBackupRestore(manifest);
  const prepared = prepareContactBackupRestore({
    manifest, backupSnapshot, currentSnapshot, derivedContactsToDelete, sourceAliases,
    plannedAt: clock.now().toISOString(),
  });
  let parent = await manageCleanupWorkflow.start({
    source: manifest.source,
    snapshotId: currentSnapshot.id,
    backupId: manifest.id,
    changeSet: prepared.changeSet,
  });
  parent = await manageCleanupWorkflow.preflight(parent, prepared.writePlan);
  return executeSimulatorFixtureTransactions(parent);
}

export interface SimulatorTransactionBatchResult {
  readonly transactions: readonly CleanupWorkflow[];
  readonly completedCount: number;
  readonly rolledBackCount: number;
  readonly attentionCount: number;
}

export async function executeSimulatorFixtureTransactions(
  parent: CleanupWorkflow,
): Promise<SimulatorTransactionBatchResult> {
  if (!__DEV__ || Platform.OS !== 'ios' || Device.isDevice || parent.phase !== 'preflighted') {
    throw new Error('A simulator preflight is required for per-change execution.');
  }
  const children = await createPerChangeCleanupWorkflows.execute(parent);
  await repository.discard(parent.id, parent.revision);
  const transactions: CleanupWorkflow[] = [];
  for (const child of children) {
    if (child.phase !== 'preflighted' || !child.writePlan) {
      transactions.push(child);
      continue;
    }
    assertSimulatorFixtureWritePlan(child.writePlan);
    const permission = await getPermissionsAsync();
    const authorization = gate.authorize({
      workflow: child,
      certification,
      runtime: {
        platform: 'ios',
        fullContactAccess: permission.granted && permission.accessPrivileges === 'all',
        explicitUserConfirmation: true,
        verifiedBackupId: child.backupId,
        freshSnapshotId: child.writePlan.freshSnapshotId,
      },
      now: clock.now(),
    });
    transactions.push(await executor.execute(child, authorization));
  }
  return Object.freeze({
    transactions: Object.freeze(transactions),
    completedCount: transactions.filter(({ phase }) => phase === 'completed').length,
    rolledBackCount: transactions.filter(({ phase }) => phase === 'rolled-back').length,
    attentionCount: transactions.filter(({ phase }) => !['completed', 'rolled-back'].includes(phase)).length,
  });
}

export async function recoverInterruptedSimulatorFixtureWrite(
  workflow: CleanupWorkflow,
): Promise<CleanupWorkflow> {
  if (!__DEV__ || Platform.OS !== 'ios' || Device.isDevice) {
    throw new Error('Native fixture recovery is restricted to the iOS Simulator.');
  }
  if (workflow.phase !== 'applying' || !workflow.writePlan) {
    throw new Error('The workflow does not contain an interrupted simulator write.');
  }
  assertSimulatorFixtureWritePlan(workflow.writePlan);
  const failed = transitionCleanupWorkflow(
    workflow,
    'failed',
    clock.now().toISOString(),
    { code: 'write-outcome-unknown', recoverable: true },
  );
  await repository.save(failed, workflow.revision);
  return reconciler.execute(failed);
}

export async function resumeSimulatorFixtureVerification(
  workflow: CleanupWorkflow,
): Promise<CleanupWorkflow> {
  if (!__DEV__ || Platform.OS !== 'ios' || Device.isDevice || workflow.phase !== 'verifying' || !workflow.writePlan) {
    throw new Error('Simulator verification recovery is unavailable.');
  }
  assertSimulatorFixtureWritePlan(workflow.writePlan);
  const permission = await getPermissionsAsync();
  const authorization = gate.authorizeVerification({
    workflow,
    certification,
    runtime: {
      platform: 'ios',
      fullContactAccess: permission.granted && permission.accessPrivileges === 'all',
      explicitUserConfirmation: true,
      verifiedBackupId: workflow.backupId,
      freshSnapshotId: workflow.writePlan.freshSnapshotId,
    },
    now: clock.now(),
  });
  return verificationResumer.execute(workflow, authorization);
}

export async function resumeSimulatorFixtureFinalization(
  workflow: CleanupWorkflow,
): Promise<CleanupWorkflow> {
  if (!__DEV__ || Platform.OS !== 'ios' || Device.isDevice || workflow.phase !== 'finalizing' || !workflow.writePlan) {
    throw new Error('Simulator finalization recovery is unavailable.');
  }
  assertSimulatorFixtureWritePlan(workflow.writePlan);
  const permission = await getPermissionsAsync();
  const authorization = gate.authorizeFinalization({
    workflow,
    certification,
    runtime: {
      platform: 'ios',
      fullContactAccess: permission.granted && permission.accessPrivileges === 'all',
      explicitUserConfirmation: true,
      verifiedBackupId: workflow.backupId,
      freshSnapshotId: workflow.writePlan.freshSnapshotId,
    },
    now: clock.now(),
  });
  return finalizationResumer.execute(workflow, authorization);
}
