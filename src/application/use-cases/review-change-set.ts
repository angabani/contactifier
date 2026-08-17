import { createChangeSet, type ChangeDecision, type ChangeSet } from '@/domain';

export type ReviewDecision = Exclude<ChangeDecision, 'pending'>;

export interface ChangeDecisionSummary {
  readonly accepted: number;
  readonly pending: number;
  readonly rejected: number;
  readonly skipped: number;
  readonly readyToApply: boolean;
}

export function summarizeChangeDecisions(changeSet: ChangeSet): ChangeDecisionSummary {
  const counts = changeSet.changes.reduce(
    (result, change) => ({ ...result, [change.decision]: result[change.decision] + 1 }),
    { accepted: 0, rejected: 0, skipped: 0, pending: 0 },
  );
  return Object.freeze({ ...counts, readyToApply: counts.pending === 0 });
}

export function setChangeDecision(
  changeSet: ChangeSet,
  changeId: string,
  decision: ReviewDecision,
): ChangeSet {
  if (!changeSet.changes.some(({ id }) => id === changeId)) {
    throw new Error(`Cannot decide unknown change ${changeId}.`);
  }
  return createChangeSet({
    ...changeSet,
    changes: changeSet.changes.map((change) =>
      change.id === changeId ? { ...change, decision } : change,
    ),
  });
}
