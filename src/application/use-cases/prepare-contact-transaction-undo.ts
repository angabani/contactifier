import {
  contactsSemanticallyEqual,
  createChangeSet,
  validateContactWritePlan,
  type CanonicalContact,
  type ChangeSet,
  type CleanupWorkflow,
  type ContactSnapshot,
  type ContactWriteCompensation,
  type ContactWriteOperation,
  type ContactWritePlan,
} from '@/domain';

import { isPerChangeCleanupWorkflow } from './create-per-change-cleanup-workflows';

export interface PreparedContactTransactionUndo {
  readonly changeSet: ChangeSet;
  readonly writePlan: ContactWritePlan;
}

function appliedSourceId(workflow: CleanupWorkflow, operationId: string): string {
  const receipt = workflow.journal.find(
    (entry) => entry.operationId === operationId && entry.outcome === 'applied' && entry.receipt,
  )?.receipt;
  if (!receipt) throw new Error(`Verified receipt ${operationId} is unavailable.`);
  return receipt.sourceContactId;
}

export function prepareContactTransactionUndo(input: {
  readonly workflow: CleanupWorkflow;
  readonly currentSnapshot: ContactSnapshot;
  readonly plannedAt: string;
}): PreparedContactTransactionUndo {
  const { workflow, currentSnapshot, plannedAt } = input;
  if (workflow.phase !== 'completed' || !workflow.writePlan) {
    throw new Error('Only a completed transaction can be undone.');
  }
  if (!isPerChangeCleanupWorkflow(workflow)) {
    throw new Error('Undo requires an independently journaled transaction.');
  }
  const original = workflow.changeSet.changes[0];
  if (!original) throw new Error('The original change is unavailable.');
  const changeId = `undo-${original.id}`;
  const changeSetId = `${workflow.changeSet.id}:undo:transaction:${original.id}`;
  const change = { ...original, id: changeId, decision: 'accepted' as const };
  const changeSet = createChangeSet({
    id: changeSetId,
    snapshotId: currentSnapshot.id,
    createdAt: plannedAt,
    changes: [change],
  });
  const currentBySourceId = new Map(
    currentSnapshot.contacts.map((contact) => [contact.recordRef.sourceContactId, contact]),
  );
  const operations: ContactWriteOperation[] = [];
  const addCreate = (contact: CanonicalContact, index: number) => {
    const id = `${changeId}:create:${index}`;
    operations.push({
      id,
      changeId,
      kind: 'create',
      contact,
      reconciliationMarker: `contactifier://write/${encodeURIComponent(currentSnapshot.id)}/${encodeURIComponent(id)}`,
    });
  };

  if (original.kind === 'update') {
    const current = currentBySourceId.get(original.after.recordRef.sourceContactId);
    if (!current || !contactsSemanticallyEqual(current, original.after)) {
      throw new Error('The updated contact changed after the original transaction.');
    }
    operations.push({
      id: `${changeId}:update:0`, changeId, kind: 'update',
      sourceContactId: current.recordRef.sourceContactId,
      before: current, after: original.before,
    });
  } else if (original.kind === 'delete') {
    addCreate(original.before, 0);
  } else {
    const originalTarget = workflow.writePlan.operations.find(
      (operation) => operation.changeId === original.id &&
        (operation.kind === 'create' || operation.kind === 'update'),
    );
    if (!originalTarget) throw new Error('The original merge target is unavailable.');
    const targetSourceId = originalTarget.kind === 'create'
      ? appliedSourceId(workflow, originalTarget.id)
      : originalTarget.sourceContactId;
    const currentTarget = currentBySourceId.get(targetSourceId);
    if (!currentTarget || !contactsSemanticallyEqual(currentTarget, original.after)) {
      throw new Error('The merged contact changed after the original transaction.');
    }
    const survivor = original.before.find(
      ({ recordRef }) => recordRef.sourceContactId === targetSourceId,
    );
    if (survivor) {
      operations.push({
        id: `${changeId}:update:0`, changeId, kind: 'update', sourceContactId: targetSourceId,
        before: currentTarget, after: survivor,
      });
      original.before.filter((contact) => contact !== survivor).forEach(addCreate);
    } else {
      operations.push({
        id: `${changeId}:delete:0`, changeId, kind: 'delete',
        sourceContactId: targetSourceId, before: currentTarget,
      });
      original.before.forEach(addCreate);
    }
  }

  const compensations = [...operations].reverse().map((operation): ContactWriteCompensation => {
    if (operation.kind === 'create') return { kind: 'delete-created', operationId: operation.id };
    if (operation.kind === 'delete') {
      return { kind: 'recreate-deleted', operationId: operation.id, contact: operation.before };
    }
    return { kind: 'restore-update', operationId: operation.id, contact: operation.before };
  });
  const writePlan = validateContactWritePlan({
    mode: 'dry-run', changeSetId, analyzedSnapshotId: currentSnapshot.id,
    freshSnapshotId: currentSnapshot.id, backupId: workflow.backupId, plannedAt,
    operations, compensations,
    createCount: operations.filter(({ kind }) => kind === 'create').length,
    updateCount: operations.filter(({ kind }) => kind === 'update').length,
    deleteCount: operations.filter(({ kind }) => kind === 'delete').length,
  });
  return Object.freeze({ changeSet, writePlan });
}
