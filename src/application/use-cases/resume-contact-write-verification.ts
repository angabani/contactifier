import {
  recordWorkflowCompensation,
  recordWorkflowFinalization,
  recordWorkflowRollbackCause,
  transitionCleanupWorkflow,
  type CleanupWorkflow,
  type ContactWriteReceipt,
  type CleanupWorkflowRollbackCause,
} from '@/domain';

import type { CleanupWorkflowRepository } from '../ports/cleanup-workflow-repository';
import type { Clock } from '../ports/clock';
import type { ContactWriter, ContactWriteVerifier } from '../ports/contact-writer';
import type { ContactWriteAuthorization } from '../services/contact-write-capability-gate';

export class ResumeContactWriteVerification {
  constructor(
    private readonly repository: CleanupWorkflowRepository,
    private readonly writer: ContactWriter,
    private readonly verifier: ContactWriteVerifier,
    private readonly clock: Clock,
    private readonly writerAdapterId: string,
  ) {}

  async execute(
    workflow: CleanupWorkflow,
    authorization: ContactWriteAuthorization,
  ): Promise<CleanupWorkflow> {
    authorization.assertMatches(workflow, this.writerAdapterId, this.clock.now());
    if (workflow.phase !== 'verifying' || !workflow.writePlan) {
      throw new Error('Workflow is not waiting for post-write verification.');
    }
    const receipts = workflow.journal
      .filter(({ outcome, receipt }) => outcome === 'applied' && receipt)
      .map(({ receipt }) => receipt as ContactWriteReceipt);
    try {
      if (!(await this.verifier.verify(workflow.writePlan, receipts))) {
        return this.rollback(workflow, 'verification-failed');
      }
    } catch {
      return this.rollback(workflow, 'verification-failed');
    }

    let current = await this.transition(workflow, 'finalizing');
    try {
      for (const operation of workflow.writePlan.operations) {
        if (operation.kind !== 'create') continue;
        const receipt = receipts.find(({ operationId }) => operationId === operation.id);
        if (!receipt) throw new Error(`Create receipt ${operation.id} is unavailable.`);
        current = await this.recordFinalization(current, operation.id, 'finalization-started');
        const finalizationReceipt = await this.writer.finalize(operation, receipt);
        current = await this.recordFinalization(current, operation.id, 'finalized', finalizationReceipt);
      }
      return this.transition(current, 'completed');
    } catch {
      return this.transition(current, 'failed', {
        code: 'finalization-outcome-unknown',
        recoverable: true,
      });
    }
  }

  private async rollback(workflow: CleanupWorkflow, code: CleanupWorkflowRollbackCause): Promise<CleanupWorkflow> {
    let current = recordWorkflowRollbackCause(workflow, code, this.clock.now().toISOString());
    await this.repository.save(current, workflow.revision);
    current = await this.transition(current, 'rolling-back');
    const receipts = new Map(
      current.journal
        .filter(({ outcome, receipt }) => outcome === 'applied' && receipt)
        .map(({ operationId, receipt }) => [operationId, receipt as ContactWriteReceipt]),
    );
    try {
      for (const compensation of current.writePlan?.compensations ?? []) {
        const receipt = receipts.get(compensation.operationId);
        if (!receipt) continue;
        const compensationReceipt = await this.writer.compensate(compensation, receipt);
        const next = recordWorkflowCompensation(current, compensationReceipt, this.clock.now().toISOString());
        await this.repository.save(next, current.revision);
        current = next;
      }
      return this.transition(current, 'rolled-back');
    } catch {
      return this.transition(current, 'failed', { code: `${code}-rollback-failed`, recoverable: true });
    }
  }

  private async recordFinalization(
    workflow: CleanupWorkflow,
    operationId: string,
    outcome: 'finalization-started' | 'finalized',
    receipt?: import('@/domain').ContactWriteFinalizationReceipt,
  ): Promise<CleanupWorkflow> {
    const next = recordWorkflowFinalization(workflow, operationId, outcome, this.clock.now().toISOString(), receipt);
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
