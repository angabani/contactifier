import {
  recordWorkflowCompensation,
  recordWorkflowFinalization,
  recordWorkflowOperation,
  recordWorkflowRollbackCause,
  transitionCleanupWorkflow,
  type CleanupWorkflow,
  type ContactWriteReceipt,
  type CleanupWorkflowRollbackCause,
} from '@/domain';

import type { CleanupWorkflowRepository } from '../ports/cleanup-workflow-repository';
import type { Clock } from '../ports/clock';
import {
  ContactWriteNotAppliedError,
  type ContactWriter,
  type ContactWriteVerifier,
} from '../ports/contact-writer';
import type { ContactWriteAuthorization } from '../services/contact-write-capability-gate';

export class ExecuteContactWritePlan {
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
    if (workflow.phase !== 'preflighted' || !workflow.writePlan) {
      throw new Error('Only a preflighted cleanup workflow can be executed.');
    }
    let current = await this.transition(workflow, 'applying');
    try {
      for (const operation of workflow.writePlan.operations) {
        current = await this.record(current, operation.id, 'started');
        const receipt = await this.writer.apply(operation);
        if (receipt.operationId !== operation.id) throw new Error('Writer returned a mismatched receipt.');
        current = await this.record(current, operation.id, 'applied', receipt);
      }
    } catch (error) {
      if (error instanceof ContactWriteNotAppliedError) {
        const unresolved = [...current.journal]
          .reverse()
          .find(({ outcome }) => outcome === 'started')?.operationId;
        if (unresolved) current = await this.record(current, unresolved, 'not-applied');
        return this.rollback(current, 'write-rejected');
      }
      return this.transition(current, 'failed', {
        code: 'write-outcome-unknown',
        recoverable: true,
      });
    }

    current = await this.transition(current, 'verifying');
    const receipts = current.journal
      .filter((entry) => entry.outcome === 'applied')
      .map(({ receipt }) => receipt as ContactWriteReceipt);
    try {
      if (!(await this.verifier.verify(workflow.writePlan, receipts))) {
        return this.rollback(current, 'verification-failed');
      }
    } catch {
      return this.rollback(current, 'verification-failed');
    }
    current = await this.transition(current, 'finalizing');
    try {
      for (const operation of workflow.writePlan.operations) {
        if (operation.kind !== 'create') continue;
        const receipt = receipts.find(({ operationId }) => operationId === operation.id);
        if (!receipt) throw new Error(`Create receipt ${operation.id} is unavailable.`);
        current = await this.recordFinalization(current, operation.id, 'finalization-started');
        const finalizationReceipt = await this.writer.finalize(operation, receipt);
        current = await this.recordFinalization(
          current,
          operation.id,
          'finalized',
          finalizationReceipt,
        );
      }
    } catch {
      return this.transition(current, 'failed', {
        code: 'finalization-outcome-unknown',
        recoverable: true,
      });
    }
    return this.transition(current, 'completed');
  }

  private async rollback(workflow: CleanupWorkflow, code: CleanupWorkflowRollbackCause): Promise<CleanupWorkflow> {
    let current = await this.transition(workflow, 'failed', { code, recoverable: true });
    const withCause = recordWorkflowRollbackCause(current, code, this.clock.now().toISOString());
    await this.repository.save(withCause, current.revision);
    current = withCause;
    current = await this.transition(current, 'rolling-back');
    const receipts = new Map(
      current.journal
        .filter((entry) => entry.outcome === 'applied' && entry.receipt)
        .map((entry) => [entry.operationId, entry.receipt as ContactWriteReceipt]),
    );
    const compensated = new Set(
      current.journal
        .filter((entry) => entry.outcome === 'compensated')
        .map(({ operationId }) => operationId),
    );
    try {
      for (const compensation of current.writePlan?.compensations ?? []) {
        const receipt = receipts.get(compensation.operationId);
        if (!receipt || compensated.has(compensation.operationId)) continue;
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
      return this.transition(current, 'failed', { code: 'rollback-failed', recoverable: true });
    }
  }

  private async record(
    workflow: CleanupWorkflow,
    operationId: string,
    outcome: 'applied' | 'not-applied' | 'started',
    receipt?: ContactWriteReceipt,
  ): Promise<CleanupWorkflow> {
    const next = recordWorkflowOperation(
      workflow,
      operationId,
      outcome,
      this.clock.now().toISOString(),
      receipt,
    );
    await this.repository.save(next, workflow.revision);
    return next;
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

  private async recordFinalization(
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
    );
    await this.repository.save(next, workflow.revision);
    return next;
  }
}
