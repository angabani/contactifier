import type { BackupManifest } from '../backups/backup-manifest';
import { contactsSemanticallyEqual } from '../backups/restore-plan';
import { validateBackupManifest } from '../backups/validate-backup-manifest';
import type { CanonicalContact } from '../contacts/contact';
import type { ContactSnapshot } from '../contacts/contact-snapshot';
import { isSameContactSource } from '../contacts/contact-source';
import { createChangeSet } from './create-change-set';
import type { ChangeSet, ProposedChange } from './proposed-change';
import { assertDomain } from '../shared/invariant';

export type ContactWriteOperation =
  | {
      readonly id: string;
      readonly changeId: string;
      readonly kind: 'create';
      readonly contact: CanonicalContact;
      readonly reconciliationMarker: string;
    }
  | {
      readonly id: string;
      readonly changeId: string;
      readonly kind: 'delete';
      readonly sourceContactId: string;
      readonly before: CanonicalContact;
    }
  | {
      readonly id: string;
      readonly changeId: string;
      readonly kind: 'update';
      readonly sourceContactId: string;
      readonly before: CanonicalContact;
      readonly after: CanonicalContact;
    };

export type ContactWriteCompensation =
  | { readonly kind: 'delete-created'; readonly operationId: string }
  | { readonly kind: 'recreate-deleted'; readonly operationId: string; readonly contact: CanonicalContact }
  | { readonly kind: 'restore-update'; readonly operationId: string; readonly contact: CanonicalContact };

export interface ContactWritePlan {
  readonly mode: 'dry-run';
  readonly changeSetId: string;
  readonly analyzedSnapshotId: string;
  readonly freshSnapshotId: string;
  readonly backupId: string;
  readonly plannedAt: string;
  readonly operations: readonly ContactWriteOperation[];
  readonly compensations: readonly ContactWriteCompensation[];
  readonly createCount: number;
  readonly updateCount: number;
  readonly deleteCount: number;
}

export type ContactWritePlanErrorCode =
  | 'backup-mismatch'
  | 'contact-missing'
  | 'contact-overlap'
  | 'invalid-decision'
  | 'invalid-plan'
  | 'limited-access'
  | 'photo-backup-incomplete'
  | 'snapshot-mismatch'
  | 'source-mismatch'
  | 'stale-contact'
  | 'target-collision';

export class ContactWritePlanError extends Error {
  constructor(readonly code: ContactWritePlanErrorCode, message: string) {
    super(message);
    this.name = 'ContactWritePlanError';
  }
}

export function validateContactWritePlan(plan: ContactWritePlan): ContactWritePlan {
  assertDomain(plan.mode === 'dry-run', 'Unsupported contact write plan mode.');
  assertDomain(plan.changeSetId.trim().length > 0, 'Write plan change set id is required.');
  assertDomain(plan.analyzedSnapshotId.trim().length > 0, 'Analyzed snapshot id is required.');
  assertDomain(plan.freshSnapshotId.trim().length > 0, 'Fresh snapshot id is required.');
  assertDomain(plan.backupId.trim().length > 0, 'Write plan backup id is required.');
  assertDomain(!Number.isNaN(Date.parse(plan.plannedAt)), 'Write plan plannedAt must be valid.');

  const operationIds = new Set<string>();
  for (const operation of plan.operations) {
    assertDomain(operation.id.trim().length > 0, 'Write operation id is required.');
    assertDomain(operation.changeId.trim().length > 0, 'Write operation change id is required.');
    assertDomain(!operationIds.has(operation.id), `Duplicate write operation id: ${operation.id}.`);
    operationIds.add(operation.id);
    if (operation.kind === 'create') {
      assertDomain(
        operation.reconciliationMarker.startsWith('contactifier://write/') &&
          operation.reconciliationMarker.length <= 512,
        `Create operation ${operation.id} requires a valid reconciliation marker.`,
      );
    }
  }

  assertDomain(
    plan.createCount === plan.operations.filter(({ kind }) => kind === 'create').length &&
      plan.updateCount === plan.operations.filter(({ kind }) => kind === 'update').length &&
      plan.deleteCount === plan.operations.filter(({ kind }) => kind === 'delete').length,
    'Write plan operation counts are inconsistent.',
  );
  assertDomain(
    plan.compensations.length === plan.operations.length,
    'Every write operation must have one compensation.',
  );
  const compensatedOperationIds = new Set<string>();
  for (const compensation of plan.compensations) {
    assertDomain(
      operationIds.has(compensation.operationId),
      `Compensation references unknown operation: ${compensation.operationId}.`,
    );
    assertDomain(
      !compensatedOperationIds.has(compensation.operationId),
      `Duplicate compensation for operation: ${compensation.operationId}.`,
    );
    compensatedOperationIds.add(compensation.operationId);
  }
  return Object.freeze({
    ...plan,
    operations: Object.freeze([...plan.operations]),
    compensations: Object.freeze([...plan.compensations]),
  });
}

export function compensationsForExecutedOperations(
  plan: ContactWritePlan,
  executedOperationIds: readonly string[],
): readonly ContactWriteCompensation[] {
  const executed = new Set(executedOperationIds);
  return Object.freeze(
    plan.compensations.filter(({ operationId }) => executed.has(operationId)),
  );
}

function acceptedBefore(change: ProposedChange): readonly CanonicalContact[] {
  return change.kind === 'merge' ? change.before : [change.before];
}

function operationId(changeId: string, kind: ContactWriteOperation['kind'], index = 0): string {
  return `${changeId}:${kind}:${index}`;
}

function reconciliationMarker(freshSnapshotId: string, operationId: string): string {
  return `contactifier://write/${encodeURIComponent(freshSnapshotId)}/${encodeURIComponent(operationId)}`;
}

export function createDryRunContactWritePlan(input: {
  readonly analyzedSnapshot: ContactSnapshot;
  readonly freshSnapshot: ContactSnapshot;
  readonly backup: BackupManifest;
  readonly changeSet: ChangeSet;
  readonly plannedAt: string;
}): ContactWritePlan {
  const { analyzedSnapshot, freshSnapshot, backup, changeSet, plannedAt } = input;
  validateBackupManifest(backup);
  createChangeSet(changeSet);
  if (Number.isNaN(Date.parse(plannedAt))) {
    throw new ContactWritePlanError('invalid-plan', 'Dry-run plannedAt must be valid.');
  }
  if (changeSet.snapshotId !== analyzedSnapshot.id) {
    throw new ContactWritePlanError('snapshot-mismatch', 'Change set does not match the analyzed snapshot.');
  }
  if (
    backup.snapshotId !== analyzedSnapshot.id ||
    backup.contactCount !== analyzedSnapshot.contacts.length
  ) {
    throw new ContactWritePlanError('backup-mismatch', 'Verified backup does not match the analyzed snapshot.');
  }
  if (
    !isSameContactSource(analyzedSnapshot.source, freshSnapshot.source) ||
    !isSameContactSource(analyzedSnapshot.source, backup.source)
  ) {
    throw new ContactWritePlanError('source-mismatch', 'Preflight inputs use different contact sources.');
  }
  if (freshSnapshot.accessScope === 'limited' || backup.snapshotAccessScope === 'limited') {
    throw new ContactWritePlanError(
      'limited-access',
      'Contact writes require full source access for backup and verification.',
    );
  }
  if (changeSet.changes.some(({ decision }) => decision === 'pending')) {
    throw new ContactWritePlanError('invalid-decision', 'Every suggestion must be reviewed before preflight.');
  }

  const freshBySourceId = new Map(
    freshSnapshot.contacts.map((contact) => [contact.recordRef.sourceContactId, contact]),
  );
  const accepted = changeSet.changes.filter(({ decision }) => decision === 'accepted');
  const archivedPhotos = new Set(
    (backup.photoAssets ?? []).map(({ assetId }) => assetId),
  );
  const touchedSourceIds = new Set<string>();
  for (const change of accepted) {
    if (
      change.kind !== 'delete' &&
      !isSameContactSource(change.after.recordRef.source, analyzedSnapshot.source)
    ) {
      throw new ContactWritePlanError(
        'source-mismatch',
        `Change ${change.id} produces a contact from another source.`,
      );
    }
    for (const before of acceptedBefore(change)) {
      if (
        before.photos.some(
          (photo, photoIndex) =>
            !archivedPhotos.has(photo.assetId ?? `${before.id}:${photoIndex}`),
        )
      ) {
        throw new ContactWritePlanError(
          'photo-backup-incomplete',
          `Contact ${before.id} does not have a complete verified photo backup.`,
        );
      }
      if (touchedSourceIds.has(before.recordRef.sourceContactId)) {
        throw new ContactWritePlanError(
          'contact-overlap',
          `Contact ${before.id} is targeted by multiple accepted changes.`,
        );
      }
      touchedSourceIds.add(before.recordRef.sourceContactId);
      const fresh = freshBySourceId.get(before.recordRef.sourceContactId);
      if (!fresh) {
        throw new ContactWritePlanError('contact-missing', `Contact ${before.id} is no longer available.`);
      }
      if (!contactsSemanticallyEqual(fresh, before)) {
        throw new ContactWritePlanError('stale-contact', `Contact ${before.id} changed after review.`);
      }
    }
    if (
      change.kind === 'merge' &&
      !change.before.some(({ id }) => id === change.after.id) &&
      freshBySourceId.has(change.after.recordRef.sourceContactId)
    ) {
      throw new ContactWritePlanError(
        'target-collision',
        `Merge target ${change.after.id} already exists in the source.`,
      );
    }
  }

  const writes: ContactWriteOperation[] = [];
  const deletes: ContactWriteOperation[] = [];
  for (const change of accepted) {
    if (change.kind === 'update') {
      writes.push({
        id: operationId(change.id, 'update'),
        changeId: change.id,
        kind: 'update',
        sourceContactId: change.before.recordRef.sourceContactId,
        before: change.before,
        after: change.after,
      });
      continue;
    }
    if (change.kind === 'delete') {
      deletes.push({
        id: operationId(change.id, 'delete'),
        changeId: change.id,
        kind: 'delete',
        sourceContactId: change.before.recordRef.sourceContactId,
        before: change.before,
      });
      continue;
    }

    const survivor = change.before.find(({ id }) => id === change.after.id);
    if (survivor) {
      writes.push({
        id: operationId(change.id, 'update'),
        changeId: change.id,
        kind: 'update',
        sourceContactId: survivor.recordRef.sourceContactId,
        before: survivor,
        after: change.after,
      });
    } else {
      const id = operationId(change.id, 'create');
      writes.push({
        id,
        changeId: change.id,
        kind: 'create',
        contact: change.after,
        reconciliationMarker: reconciliationMarker(freshSnapshot.id, id),
      });
    }
    change.before.forEach((before, index) => {
      if (survivor?.id === before.id) return;
      deletes.push({
        id: operationId(change.id, 'delete', index),
        changeId: change.id,
        kind: 'delete',
        sourceContactId: before.recordRef.sourceContactId,
        before,
      });
    });
  }

  const operations = [...writes, ...deletes];
  const compensations = [...operations].reverse().map((operation): ContactWriteCompensation => {
    if (operation.kind === 'create') {
      return { kind: 'delete-created', operationId: operation.id };
    }
    if (operation.kind === 'delete') {
      return { kind: 'recreate-deleted', operationId: operation.id, contact: operation.before };
    }
    return { kind: 'restore-update', operationId: operation.id, contact: operation.before };
  });

  return validateContactWritePlan(Object.freeze({
    mode: 'dry-run',
    changeSetId: changeSet.id,
    analyzedSnapshotId: analyzedSnapshot.id,
    freshSnapshotId: freshSnapshot.id,
    backupId: backup.id,
    plannedAt,
    operations: Object.freeze(operations),
    compensations: Object.freeze(compensations),
    createCount: operations.filter(({ kind }) => kind === 'create').length,
    updateCount: operations.filter(({ kind }) => kind === 'update').length,
    deleteCount: operations.filter(({ kind }) => kind === 'delete').length,
  }));
}
