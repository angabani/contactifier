import {
  createCleanupWorkflow,
  recordWorkflowPreflight,
  recordWorkflowReview,
  type ChangeSet,
  type CleanupWorkflow,
  type ContactSourceRef,
  type ContactWritePlan,
} from '@/domain';

import type { Clock } from '../ports/clock';
import type {
  CleanupWorkflowRepository,
  CleanupWorkflowSummary,
} from '../ports/cleanup-workflow-repository';
import type { IdGenerator } from '../ports/id-generator';

export interface StartCleanupWorkflowRequest {
  readonly source: ContactSourceRef;
  readonly snapshotId: string;
  readonly backupId: string;
  readonly changeSet: ChangeSet;
}

export class ManageCleanupWorkflow {
  constructor(
    private readonly repository: CleanupWorkflowRepository,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  async start(request: StartCleanupWorkflowRequest): Promise<CleanupWorkflow> {
    const createdAt = this.clock.now().toISOString();
    const workflow = createCleanupWorkflow({
      id: this.idGenerator.nextId(),
      ...request,
      createdAt,
    });
    await this.repository.save(workflow, null);
    return workflow;
  }

  async checkpoint(
    workflow: CleanupWorkflow,
    expectedRevision: number,
  ): Promise<CleanupWorkflow> {
    await this.repository.save(workflow, expectedRevision);
    return workflow;
  }

  async review(workflow: CleanupWorkflow, changeSet: ChangeSet): Promise<CleanupWorkflow> {
    const next = recordWorkflowReview(workflow, changeSet, this.clock.now().toISOString());
    return this.checkpoint(next, workflow.revision);
  }

  async preflight(
    workflow: CleanupWorkflow,
    writePlan: ContactWritePlan,
  ): Promise<CleanupWorkflow> {
    const next = recordWorkflowPreflight(workflow, writePlan, this.clock.now().toISOString());
    return this.checkpoint(next, workflow.revision);
  }

  load(workflowId: string): Promise<CleanupWorkflow | null> {
    return this.repository.load(workflowId);
  }

  listResumable(): Promise<readonly CleanupWorkflowSummary[]> {
    return this.repository.listResumable();
  }
}
