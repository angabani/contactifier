import type { CleanupWorkflowPhase } from '@/domain';

import type { CleanupWorkflowRepository } from '../ports/cleanup-workflow-repository';

const protectedPhases: readonly CleanupWorkflowPhase[] = [
  'applying',
  'rolling-back',
  'verifying',
];

export class CleanupWorkflowDiscardError extends Error {
  constructor(readonly code: 'active-operation') {
    super('A cleanup workflow cannot be discarded during an active write, verification, or rollback.');
    this.name = 'CleanupWorkflowDiscardError';
  }
}

export class DiscardCleanupWorkflow {
  constructor(private readonly repository: CleanupWorkflowRepository) {}

  async execute(workflowId: string): Promise<void> {
    let workflow;
    try {
      workflow = await this.repository.load(workflowId);
    } catch {
      const summaries = this.repository.listAll
        ? await this.repository.listAll()
        : await this.repository.listResumable();
      const summary = summaries.find(({ id }) => id === workflowId);
      if (!summary) {
        await this.repository.discard(workflowId, null);
        return;
      }
      if (protectedPhases.includes(summary.phase)) {
        throw new CleanupWorkflowDiscardError('active-operation');
      }
      await this.repository.discard(workflowId, summary.revision);
      return;
    }
    if (!workflow) {
      await this.repository.discard(workflowId, null);
      return;
    }
    if (protectedPhases.includes(workflow.phase)) {
      throw new CleanupWorkflowDiscardError('active-operation');
    }
    await this.repository.discard(workflowId, workflow.revision);
  }
}
