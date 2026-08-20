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
    const workflow = await this.repository.load(workflowId);
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
