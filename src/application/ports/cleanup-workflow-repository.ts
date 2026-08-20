import type { CleanupWorkflow, CleanupWorkflowPhase } from '@/domain';

export interface CleanupWorkflowSummary {
  readonly id: string;
  readonly revision: number;
  readonly phase: CleanupWorkflowPhase;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class CleanupWorkflowConflictError extends Error {
  constructor(readonly workflowId: string) {
    super(`Cleanup workflow ${workflowId} was changed by another operation.`);
    this.name = 'CleanupWorkflowConflictError';
  }
}

export interface CleanupWorkflowRepository {
  discard(workflowId: string, expectedRevision: number | null): Promise<void>;
  load(workflowId: string): Promise<CleanupWorkflow | null>;
  listResumable(): Promise<readonly CleanupWorkflowSummary[]>;
  save(workflow: CleanupWorkflow, expectedRevision: number | null): Promise<void>;
}
