import {
  recordWorkflowFinalization,
  transitionCleanupWorkflow,
  type CleanupWorkflow,
  type ContactWriteReceipt,
} from '@/domain';

import type { CleanupWorkflowRepository } from '../ports/cleanup-workflow-repository';
import type { Clock } from '../ports/clock';
import type { ContactWriter } from '../ports/contact-writer';
import type { ContactWriteAuthorization } from '../services/contact-write-capability-gate';

export class ResumeContactWriteFinalization {
  constructor(
    private readonly repository: CleanupWorkflowRepository,
    private readonly writer: ContactWriter,
    private readonly clock: Clock,
    private readonly writerAdapterId: string,
  ) {}

  async execute(
    workflow: CleanupWorkflow,
    authorization: ContactWriteAuthorization,
  ): Promise<CleanupWorkflow> {
    authorization.assertMatches(workflow, this.writerAdapterId, this.clock.now());
    if (
      (workflow.phase !== 'finalizing' &&
        (workflow.phase !== 'failed' || workflow.failure?.code !== 'finalization-outcome-unknown')) ||
      !workflow.writePlan
    ) {
      throw new Error('Workflow does not contain interrupted marker finalization.');
    }
    let current = workflow.phase === 'finalizing'
      ? workflow
      : await this.transition(workflow, 'finalizing');
    const appliedReceipts = new Map(
      current.journal
        .filter(({ outcome, receipt }) => outcome === 'applied' && receipt)
        .map(({ operationId, receipt }) => [operationId, receipt as ContactWriteReceipt]),
    );
    const started = new Set(
      current.journal
        .filter(({ outcome }) => outcome === 'finalization-started')
        .map(({ operationId }) => operationId),
    );
    const finalized = new Set(
      current.journal
        .filter(({ outcome }) => outcome === 'finalized')
        .map(({ operationId }) => operationId),
    );
    try {
      for (const operation of workflow.writePlan.operations) {
        if (operation.kind !== 'create' || finalized.has(operation.id)) continue;
        const receipt = appliedReceipts.get(operation.id);
        if (!receipt) throw new Error(`Create receipt ${operation.id} is unavailable.`);
        if (!started.has(operation.id)) {
          current = await this.record(current, operation.id, 'finalization-started');
        }
        const finalizationReceipt = await this.writer.finalize(operation, receipt);
        current = await this.record(current, operation.id, 'finalized', finalizationReceipt);
      }
      return this.transition(current, 'completed');
    } catch {
      return this.transition(current, 'failed', {
        code: 'finalization-outcome-unknown',
        recoverable: true,
      });
    }
  }

  private async record(
    workflow: CleanupWorkflow,
    operationId: string,
    outcome: 'finalization-started' | 'finalized',
    receipt?: import('@/domain').ContactWriteFinalizationReceipt,
  ): Promise<CleanupWorkflow> {
    const next = recordWorkflowFinalization(
      workflow,
      operationId,
      outcome,
      this.clock.now().toISOString(),
      receipt,
      'recovery',
    );
    await this.repository.save(next, workflow.revision);
    return next;
  }

  private async transition(
    workflow: CleanupWorkflow,
    phase: Parameters<typeof transitionCleanupWorkflow>[1],
    failure?: { readonly code: string; readonly recoverable: boolean },
  ): Promise<CleanupWorkflow> {
    const next = transitionCleanupWorkflow(workflow, phase, this.clock.now().toISOString(), failure);
    await this.repository.save(next, workflow.revision);
    return next;
  }
}
