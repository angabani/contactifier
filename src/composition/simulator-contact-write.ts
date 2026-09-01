import * as Device from 'expo-device';
import { Contact, getPermissionsAsync } from 'expo-contacts';
import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import {
  ContactWriteCapabilityGate,
  ContactWriteCapabilityError,
  ExecuteContactWritePlan,
  PhotoMaterializingContactWriter,
  prepareContactTransactionUndo,
  prepareContactBackupRestore,
  ReconcileUnknownContactWrite,
  ResumeContactWriteVerification,
  ResumeContactWriteFinalization,
  WithMaterializedContactPhotos,
  type ContactWriter,
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
import { createIosPermissionDenialEvidence } from '@/features/developer/ios-certification-permission-evidence';
import { createIosPhotoRoundTripEvidence } from '@/features/developer/ios-certification-photo-evidence';
import { reconcileSimulatorFixtureRestoreIdentity } from '@/features/developer/simulator-fixture-restore-identity';
import { ExpoIosContactWriter } from '@/infrastructure/contacts/expo/expo-ios-contact-writer';
import { ExpoIosContactGroupMembershipReader } from '@/infrastructure/contacts/expo/expo-ios-contact-group-membership-reader';
import { ExpoIosContactGroupMembershipWriter } from '@/infrastructure/contacts/expo/expo-ios-contact-group-membership-writer';
import { DEVICE_CONTACT_FIELDS } from '@/infrastructure/contacts/expo/device-contact-fields';
import { SystemClock } from '@/infrastructure/system/system-clock';
import {
  createPerChangeCleanupWorkflows,
  manageCleanupWorkflow,
  workflowRepository as repository,
} from './cleanup-workflow';
import { backupStore, listContactBackups, loadContactBackup } from './contact-backup';
import { readDeviceContacts } from './device-contact-scan';
import { iosCertificationEvidence } from './ios-certification-evidence';
import { iosCertificationPhotoEvidence } from './ios-certification-photo-evidence';

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
const writer = new ExpoIosContactWriter(
  undefined,
  new ExpoIosContactGroupMembershipReader(),
  new ExpoIosContactGroupMembershipWriter(),
);
const finalizationResumer = new ResumeContactWriteFinalization(repository, writer, clock, ADAPTER_ID);
const gate = new ContactWriteCapabilityGate();

async function photoAwareWriterFor(workflow: CleanupWorkflow): Promise<PhotoMaterializingContactWriter> {
  const manifest = (await listContactBackups.execute()).find(({ id }) => id === workflow.backupId);
  if (!manifest) throw new Error(`Verified backup ${workflow.backupId} is unavailable.`);
  return new PhotoMaterializingContactWriter(
    writer,
    new WithMaterializedContactPhotos(backupStore),
    manifest,
  );
}

async function executorFor(workflow: CleanupWorkflow): Promise<ExecuteContactWritePlan> {
  return new ExecuteContactWritePlan(
    repository,
    await photoAwareWriterFor(workflow),
    writer,
    clock,
    ADAPTER_ID,
  );
}

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
  return (await executorFor(workflow)).execute(workflow, authorization);
}

export async function executeSimulatorVerificationFailureTrial(
  workflow: CleanupWorkflow,
): Promise<CleanupWorkflow> {
  if (!__DEV__ || Platform.OS !== 'ios' || Device.isDevice) {
    throw new Error('Rollback certification is restricted to the iOS Simulator.');
  }
  if (workflow.phase !== 'preflighted' || !workflow.writePlan || workflow.writePlan.operations.length !== 1) {
    throw new Error('Rollback certification requires one persisted per-change preflight.');
  }
  assertSimulatorFixtureWritePlan(workflow.writePlan);
  const permission = await getPermissionsAsync();
  const authorization = gate.authorize({
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
  const result = await new ExecuteContactWritePlan(
    repository,
    await photoAwareWriterFor(workflow),
    { verify: async () => false },
    clock,
    ADAPTER_ID,
  ).execute(workflow, authorization);
  if (
    result.phase !== 'rolled-back' || result.rollbackCause !== 'verification-failed' ||
    !result.journal.some(({ outcome }) => outcome === 'compensated')
  ) throw new Error('The forced verification-failure trial did not complete compensation safely.');
  return result;
}

export async function executeSimulatorLostWriteResponseTrial(
  workflow: CleanupWorkflow,
): Promise<CleanupWorkflow> {
  if (!__DEV__ || Platform.OS !== 'ios' || Device.isDevice) {
    throw new Error('Write-interruption certification is restricted to the iOS Simulator.');
  }
  if (workflow.phase !== 'preflighted' || !workflow.writePlan || workflow.writePlan.operations.length !== 1) {
    throw new Error('Write-interruption certification requires one persisted per-change preflight.');
  }
  assertSimulatorFixtureWritePlan(workflow.writePlan);
  const permission = await getPermissionsAsync();
  const authorization = gate.authorize({
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
  const delegate = await photoAwareWriterFor(workflow);
  const lostResponseWriter: ContactWriter = {
    apply: async (operation) => {
      await delegate.apply(operation);
      throw new Error('Certification fault: native response lost after mutation.');
    },
    compensate: (compensation, receipt) => delegate.compensate(compensation, receipt),
    finalize: (operation, receipt) => delegate.finalize(operation, receipt),
  };
  const interrupted = await new ExecuteContactWritePlan(
    repository,
    lostResponseWriter,
    writer,
    clock,
    ADAPTER_ID,
  ).execute(workflow, authorization);
  if (interrupted.phase !== 'failed' || interrupted.failure?.code !== 'write-outcome-unknown') {
    throw new Error('The lost-response trial did not persist an unknown write outcome.');
  }
  const reconciled = await new ReconcileUnknownContactWrite(
    repository,
    writer,
    delegate,
    clock,
  ).execute(interrupted);
  if (
    reconciled.phase !== 'rolled-back' || reconciled.rollbackCause !== 'reconciled-write' ||
    !reconciled.journal.some(({ origin, outcome }) => origin === 'reconciliation' && outcome === 'applied')
  ) throw new Error('The interrupted native write was not reconciled and rolled back safely.');
  return reconciled;
}

export async function executeSimulatorLostFinalizationResponseTrial(
  workflow: CleanupWorkflow,
): Promise<CleanupWorkflow> {
  if (!__DEV__ || Platform.OS !== 'ios' || Device.isDevice) {
    throw new Error('Finalization-interruption certification is restricted to the iOS Simulator.');
  }
  const operation = workflow.writePlan?.operations[0];
  if (
    workflow.phase !== 'preflighted' || !workflow.writePlan ||
    workflow.writePlan.operations.length !== 1 || operation?.kind !== 'create'
  ) throw new Error('Finalization certification requires one persisted create preflight.');
  assertSimulatorFixtureWritePlan(workflow.writePlan);
  const permission = await getPermissionsAsync();
  const runtime = {
    platform: 'ios' as const,
    fullContactAccess: permission.granted && permission.accessPrivileges === 'all',
    explicitUserConfirmation: true,
    verifiedBackupId: workflow.backupId,
    freshSnapshotId: workflow.writePlan.freshSnapshotId,
  };
  const authorization = gate.authorize({ workflow, certification, runtime, now: clock.now() });
  const delegate = await photoAwareWriterFor(workflow);
  const lostFinalizationResponseWriter: ContactWriter = {
    apply: (value) => delegate.apply(value),
    compensate: (compensation, receipt) => delegate.compensate(compensation, receipt),
    finalize: async (value, receipt) => {
      await delegate.finalize(value, receipt);
      throw new Error('Certification fault: finalization response lost after marker removal.');
    },
  };
  const interrupted = await new ExecuteContactWritePlan(
    repository,
    lostFinalizationResponseWriter,
    writer,
    clock,
    ADAPTER_ID,
  ).execute(workflow, authorization);
  if (interrupted.phase !== 'failed' || interrupted.failure?.code !== 'finalization-outcome-unknown') {
    throw new Error('The trial did not persist an unknown finalization outcome.');
  }
  const refreshedPermission = await getPermissionsAsync();
  const resumedAuthorization = gate.authorizeFinalization({
    workflow: interrupted,
    certification,
    runtime: {
      ...runtime,
      fullContactAccess: refreshedPermission.granted && refreshedPermission.accessPrivileges === 'all',
    },
    now: clock.now(),
  });
  const completed = await new ResumeContactWriteFinalization(
    repository,
    delegate,
    clock,
    ADAPTER_ID,
  ).execute(interrupted, resumedAuthorization);
  if (
    completed.phase !== 'completed' ||
    !completed.journal.some(({ origin, outcome }) => origin === 'recovery' && outcome === 'finalized')
  ) throw new Error('Marker finalization did not resume idempotently under fresh authorization.');
  return completed;
}

export async function certifySimulatorPermissionDenial(
  workflow: CleanupWorkflow,
) {
  if (!__DEV__ || Platform.OS !== 'ios' || Device.isDevice) {
    throw new Error('Permission certification is restricted to the iOS Simulator.');
  }
  if (workflow.phase !== 'preflighted' || !workflow.writePlan) {
    throw new Error('An owned persisted preflight plan is required.');
  }
  assertSimulatorFixtureWritePlan(workflow.writePlan);
  const permission = await getPermissionsAsync();
  const fullContactAccess = permission.granted && permission.accessPrivileges === 'all';
  if (fullContactAccess) {
    throw new Error('Revoke or limit Contacts access, then refresh permission before running this trial.');
  }
  let denialReasons;
  try {
    gate.authorize({
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
    throw new Error('The permission gate unexpectedly authorized contact writing.');
  } catch (error) {
    if (!(error instanceof ContactWriteCapabilityError)) throw error;
    denialReasons = error.reasons;
  }
  const after = await manageCleanupWorkflow.load(workflow.id);
  if (!after) throw new Error('The certification workflow disappeared during the trial.');
  const evidence = createIosPermissionDenialEvidence({
    before: workflow,
    after,
    denialReasons,
    observedAt: clock.now().toISOString(),
  });
  await iosCertificationEvidence.save(evidence);
  return evidence;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function certifySimulatorPhotoRoundTrip(
  workflow: CleanupWorkflow,
  manifest: BackupManifest,
) {
  if (!__DEV__ || Platform.OS !== 'ios' || Device.isDevice) {
    throw new Error('Photo certification is restricted to the iOS Simulator.');
  }
  if (workflow.backupId !== manifest.id || workflow.phase !== 'completed' || !workflow.writePlan) {
    throw new Error('A completed restoration for the selected verified backup is required.');
  }
  assertSimulatorFixtureWritePlan(workflow.writePlan);
  const candidate = workflow.writePlan.operations.flatMap((operation) => {
    if (operation.kind !== 'create') return [];
    const photo = operation.contact.photos[0];
    if (!photo) return [];
    const assetId = photo.assetId ?? `${operation.contact.id}:0`;
    const asset = manifest.photoAssets?.find((item) => item.assetId === assetId);
    const receipt = workflow.journal.find((entry) =>
      entry.operationId === operation.id && entry.outcome === 'applied' && entry.receipt)?.receipt;
    return asset && receipt ? [{ operation, asset, receipt }] : [];
  })[0];
  if (!candidate) throw new Error('No receipted recreated photo exists in this restoration.');
  const native = await new Contact(candidate.receipt.sourceContactId).getDetails(DEVICE_CONTACT_FIELDS);
  const uri = native.image ?? native.thumbnail;
  if (!uri) throw new Error('The restored native contact has no readable photo.');
  const file = new File(uri);
  if (!file.exists) throw new Error('The restored native photo file is unavailable.');
  const actualSha256 = hex(await digest(CryptoDigestAlgorithm.SHA256, await file.bytes()));
  const evidence = createIosPhotoRoundTripEvidence({
    workflow,
    operationId: candidate.operation.id,
    assetId: candidate.asset.assetId,
    nativeContactId: candidate.receipt.sourceContactId,
    expectedSha256: candidate.asset.plaintextSha256,
    actualSha256,
    observedAt: clock.now().toISOString(),
  });
  await iosCertificationPhotoEvidence.save(evidence);
  return evidence;
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
    transactions.push(await (await executorFor(child)).execute(child, authorization));
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
  return new ReconcileUnknownContactWrite(
    repository,
    writer,
    await photoAwareWriterFor(failed),
    clock,
  ).execute(failed);
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
  return new ResumeContactWriteVerification(
    repository,
    await photoAwareWriterFor(workflow),
    writer,
    clock,
    ADAPTER_ID,
  ).execute(workflow, authorization);
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
