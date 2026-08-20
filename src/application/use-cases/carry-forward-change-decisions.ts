import {
  contactsSemanticallyEqual,
  createChangeSet,
  type ChangeSet,
  type CleanupWorkflow,
  type ProposedChange,
} from '@/domain';

function beforeContacts(change: ProposedChange) {
  return change.kind === 'merge' ? change.before : [change.before];
}

function sameUnchangedTarget(left: ProposedChange, right: ProposedChange): boolean {
  if (left.kind !== right.kind) return false;
  const leftBefore = beforeContacts(left);
  const rightBySourceId = new Map(
    beforeContacts(right).map((contact) => [contact.recordRef.sourceContactId, contact]),
  );
  return leftBefore.length === rightBySourceId.size && leftBefore.every((contact) => {
    const current = rightBySourceId.get(contact.recordRef.sourceContactId);
    return current ? contactsSemanticallyEqual(contact, current) : false;
  });
}

export function carryForwardChangeDecisions(
  current: ChangeSet,
  history: readonly CleanupWorkflow[],
): ChangeSet {
  const previousChanges = [...history]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .flatMap((workflow) => workflow.changeSet.changes.map((change) => ({ workflow, change })));
  return createChangeSet({
    ...current,
    changes: current.changes.map((change) => {
      const previous = previousChanges.find(({ change: candidate }) =>
        sameUnchangedTarget(candidate, change),
      );
      if (!previous) return change;
      if (previous.change.decision === 'rejected' || previous.change.decision === 'skipped') {
        return { ...change, decision: previous.change.decision };
      }
      return { ...change, decision: 'pending' };
    }),
  });
}
