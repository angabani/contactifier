import {
  recordWorkflowCompensation,
  recordWorkflowReconciliation,
  transitionCleanupWorkflow,
  type CleanupWorkflow,
  type ContactWriteReceipt,
} from '@/domain';

import type { CleanupWorkflowRepository } from '../ports/cleanup-workflow-repository';
import type { Clock } from '../ports/clock';
import type { ContactWriter, ContactWriteReconciler } from '../ports/contact-writer';

export class ReconcileUnknownContactWrite {
  constructor(
    private readonly repository: CleanupWorkflowRepository,
    private readonly reconciler: ContactWriteReconciler,
    private readonly writer: ContactWriter,
    private readonly clock: Clock,
  ) {}

  async execute(workflow: CleanupWorkflow): Promise<CleanupWorkflow> {
    if (
      workflow.phase !== 'failed' ||
      workflow.failure?.code !== 'write-outcome-unknown' ||
      !workflow.writePlan
    ) {
      throw new Error('Workflow does not contain an unknown write outcome.');
    }
    const writePlan = workflow.writePlan;
    const resolved = new Set(
      workflow.journal
        .filter(({ outcome }) => ['ambiguous', 'applied', 'not-applied'].includes(outcome))
        .map(({ operationId }) => operationId),
    );
    const unresolvedId = workflow.journal.find(
      ({ operationId, outcome }) => outcome === 'started' && !resolved.has(operationId),
    )?.operationId;
    const operation = writePlan.operations.find(({ id }) => id === unresolvedId);
    if (!operation) throw new Error('Unknown write operation cannot be identified.');

    const reconciliation = await this.reconciler.reconcile(operation);
    let current = recordWorkflowReconciliation(
      workflow,
      operation.id,
      reconciliation.outcome,
      this.clock.now().toISOString(),
      reconciliation.outcome === 'applied' ? reconciliation.receipt : undefined,
    );
    await this.repository.save(current, workflow.revision);
    if (reconciliation.outcome === 'ambiguous') return current;

    current = await this.transition(current, 'rolling-back');
    const receipts = new Map(
      current.journal
        .filter((entry) => entry.outcome === 'applied' && entry.receipt)
        .map((entry) => [entry.operationId, entry.receipt as ContactWriteReceipt]),
    );
    try {
      for (const compensation of writePlan.compensations) {
        const receipt = receipts.get(compensation.operationId);
        if (!receipt) continue;
        const compensationReceipt = await this.writer.compensate(compensation, receipt);
        const next = recordWorkflowCompensation(
          current,
          compensationReceipt,
          this.clock.now().toISOString(),
        );
        await this.repository.save(next, current.revision);
        current = next;
      }
      return this.transition(current, 'rolled-back');
    } catch {
      return this.transition(current, 'failed', {
        code: 'rollback-failed',
        recoverable: true,
      });
    }
  }

  private async transition(
    workflow: CleanupWorkflow,
    phase: Parameters<typeof transitionCleanupWorkflow>[1],
    failure?: { readonly code: string; readonly recoverable: boolean },
  ): Promise<CleanupWorkflow> {
    const next = transitionCleanupWorkflow(
      workflow,
      phase,
      this.clock.now().toISOString(),
      failure,
    );
    await this.repository.save(next, workflow.revision);
    return next;
  }
}
