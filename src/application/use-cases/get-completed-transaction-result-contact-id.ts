import type { CleanupWorkflow } from '@/domain';

/**
 * Resolves the exact native contact produced by a completed per-change transaction.
 * The identifier comes only from a durable write/finalization receipt; reviewed
 * canonical ids and display values are never treated as native lookup keys.
 */
export function getCompletedTransactionResultContactId(
  workflow: CleanupWorkflow,
): string | null {
  if (workflow.phase !== 'completed' || !workflow.writePlan) return null;
  const accepted = workflow.changeSet.changes.filter(({ decision }) => decision === 'accepted');
  if (accepted.length !== 1 || accepted[0].kind === 'delete') return null;

  const resultOperation = workflow.writePlan.operations.find(
    ({ changeId, kind }) => changeId === accepted[0].id && (kind === 'create' || kind === 'update'),
  );
  if (!resultOperation) return null;

  if (resultOperation.kind === 'create') {
    const finalized = [...workflow.journal].reverse().find(
      ({ operationId, outcome }) => operationId === resultOperation.id && outcome === 'finalized',
    );
    return finalized?.finalizationReceipt?.sourceContactId ?? null;
  }

  const applied = [...workflow.journal].reverse().find(
    ({ operationId, outcome }) => operationId === resultOperation.id && outcome === 'applied',
  );
  return applied?.receipt?.sourceContactId ?? null;
}
