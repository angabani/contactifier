import {
  createChangeSet,
  createConfidenceScore,
  createContactRestorePlan,
  validateContactWritePlan,
  type BackupManifest,
  type ChangeSet,
  type ContactSnapshot,
  type CanonicalContact,
  type ContactWriteCompensation,
  type ContactWriteOperation,
  type ContactWritePlan,
  type ProposedChange,
} from '@/domain';

export interface PreparedContactBackupRestore {
  readonly changeSet: ChangeSet;
  readonly writePlan: ContactWritePlan;
}

export function prepareContactBackupRestore(input: {
  readonly manifest: BackupManifest;
  readonly backupSnapshot: ContactSnapshot;
  readonly currentSnapshot: ContactSnapshot;
  readonly plannedAt: string;
  readonly derivedContactsToDelete?: readonly CanonicalContact[];
  readonly sourceAliases?: ReadonlyMap<string, string>;
}): PreparedContactBackupRestore {
  const { manifest, backupSnapshot, currentSnapshot, plannedAt } = input;
  const derivedContactsToDelete = input.derivedContactsToDelete ?? [];
  if (currentSnapshot.accessScope !== 'all' || backupSnapshot.accessScope !== 'all') {
    throw new Error('Full contact access is required to restore a backup.');
  }
  const restore = createContactRestorePlan(
    backupSnapshot,
    currentSnapshot,
    input.sourceAliases,
  );
  if (restore.unavailableCount > 0) throw new Error('Unavailable contacts cannot be restored safely.');
  const affected = restore.items.filter(({ kind }) => kind === 'update' || kind === 'recreate');
  if (affected.length === 0 && derivedContactsToDelete.length === 0) {
    throw new Error('This backup already matches the contact directory.');
  }
  const changeSetId = `${manifest.id}:restore:${currentSnapshot.id}`;
  const restoreChanges: ProposedChange[] = affected.map((item, index) => {
    const id = `restore-${index}-${item.backupContact.id}`;
    const before = item.currentContact ?? item.backupContact;
    const after = item.currentContact
      ? { ...item.backupContact, id: item.currentContact.id, recordRef: item.currentContact.recordRef }
      : item.backupContact;
    return {
      id, kind: 'update', contactId: before.id,
      before, after,
      origin: 'user', confidence: createConfidenceScore(1), reasons: ['Restore exact contact from verified backup'],
      decision: 'accepted',
    };
  });
  const deleteChanges: ProposedChange[] = derivedContactsToDelete.map((contact, index) => ({
    id: `restore-delete-derived-${index}-${contact.id}`,
    kind: 'delete', contactId: contact.id, before: contact,
    origin: 'user', confidence: createConfidenceScore(1),
    reasons: ['Remove verified Contactifier-created merge result absent from backup'],
    decision: 'accepted',
  }));
  const changes = [...restoreChanges, ...deleteChanges];
  const changeSet = createChangeSet({
    id: changeSetId, snapshotId: currentSnapshot.id, createdAt: plannedAt, changes,
  });
  const restoreOperations: ContactWriteOperation[] = affected.map((item, index) => {
    const changeId = restoreChanges[index].id;
    if (item.kind === 'update' && item.currentContact) {
      const after = {
        ...item.backupContact,
        id: item.currentContact.id,
        recordRef: item.currentContact.recordRef,
      };
      return {
        id: `${changeId}:update:0`, changeId, kind: 'update',
        sourceContactId: item.currentContact.recordRef.sourceContactId,
        before: item.currentContact, after,
      };
    }
    const id = `${changeId}:create:0`;
    return {
      id, changeId, kind: 'create', contact: item.backupContact,
      reconciliationMarker: `contactifier://write/${encodeURIComponent(currentSnapshot.id)}/${encodeURIComponent(id)}`,
    };
  });
  const deleteOperations: ContactWriteOperation[] = derivedContactsToDelete.map((contact, index) => ({
    id: `${deleteChanges[index].id}:delete:0`,
    changeId: deleteChanges[index].id,
    kind: 'delete',
    sourceContactId: contact.recordRef.sourceContactId,
    before: contact,
  }));
  const operations = [...restoreOperations, ...deleteOperations];
  const compensations = [...operations].reverse().map((operation): ContactWriteCompensation =>
    operation.kind === 'create'
      ? { kind: 'delete-created', operationId: operation.id }
      : operation.kind === 'delete'
        ? { kind: 'recreate-deleted', operationId: operation.id, contact: operation.before }
        : { kind: 'restore-update', operationId: operation.id, contact: operation.before },
  );
  const writePlan = validateContactWritePlan({
    mode: 'dry-run', changeSetId, analyzedSnapshotId: currentSnapshot.id,
    freshSnapshotId: currentSnapshot.id, backupId: manifest.id, plannedAt,
    operations, compensations,
    createCount: operations.filter(({ kind }) => kind === 'create').length,
    updateCount: operations.filter(({ kind }) => kind === 'update').length,
    deleteCount: deleteOperations.length,
  });
  return Object.freeze({ changeSet, writePlan });
}
