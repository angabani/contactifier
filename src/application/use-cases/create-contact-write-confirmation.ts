import type { ChangeSet, ContactWritePlan } from '@/domain';

export interface ContactWriteConfirmation {
  readonly acceptedTransactionCount: number;
  readonly createCount: number;
  readonly updateCount: number;
  readonly deleteCount: number;
  readonly rollbackStepCount: number;
  readonly hasVerifiedBackup: boolean;
  readonly hasDestructiveImpact: boolean;
}

export function createContactWriteConfirmation(input: {
  readonly changeSet: ChangeSet;
  readonly plan: ContactWritePlan;
  readonly verifiedBackupId?: string;
}): ContactWriteConfirmation {
  return Object.freeze({
    acceptedTransactionCount: input.changeSet.changes.filter(
      ({ decision }) => decision === 'accepted',
    ).length,
    createCount: input.plan.createCount,
    updateCount: input.plan.updateCount,
    deleteCount: input.plan.deleteCount,
    rollbackStepCount: input.plan.compensations.length,
    hasVerifiedBackup:
      Boolean(input.verifiedBackupId) && input.plan.backupId === input.verifiedBackupId,
    hasDestructiveImpact: input.plan.deleteCount > 0,
  });
}
