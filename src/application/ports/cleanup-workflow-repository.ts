import type { CleanupWorkflow, CleanupWorkflowPhase } from '@/domain';

export interface CleanupWorkflowSummary {
  readonly id: string;
  readonly revision: number;
  readonly phase: CleanupWorkflowPhase;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class CleanupWorkflowConflictError extends Error {
  constructor(
    readonly workflowId: string,
    readonly revisions?: {
      readonly expected: number | null;
      readonly actual: number | null;
      readonly attempted?: number;
    },
  ) {
    super(
      revisions
        ? `Cleanup workflow ${workflowId} revision conflict: expected ${revisions.expected ?? 'none'}, actual ${revisions.actual ?? 'none'}, attempted ${revisions.attempted ?? 'none'}.`
        : `Cleanup workflow ${workflowId} was changed by another operation.`,
    );
    this.name = 'CleanupWorkflowConflictError';
  }
}

export interface CleanupWorkflowRepository {
  discard(workflowId: string, expectedRevision: number | null): Promise<void>;
  load(workflowId: string): Promise<CleanupWorkflow | null>;
  listResumable(): Promise<readonly CleanupWorkflowSummary[]>;
  listAll?(): Promise<readonly CleanupWorkflowSummary[]>;
  save(workflow: CleanupWorkflow, expectedRevision: number | null): Promise<void>;
}
