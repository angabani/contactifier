import {
  createChangeSet,
  createCleanupWorkflow,
  recordWorkflowPreflight,
  splitContactWritePlanByChange,
  validateContactWritePlan,
  type CleanupWorkflow,
  type ContactWritePlan,
} from '@/domain';

import type { CleanupWorkflowRepository } from '../ports/cleanup-workflow-repository';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';

function childChangeSetId(parent: CleanupWorkflow, changeId: string): string {
  return `${parent.changeSet.id}:transaction:${changeId}`;
}

export function isPerChangeCleanupWorkflow(workflow: CleanupWorkflow): boolean {
  const [change] = workflow.changeSet.changes;
  return Boolean(
    change &&
    workflow.changeSet.changes.length === 1 &&
    workflow.writePlan &&
    workflow.writePlan.operations.length > 0 &&
    workflow.writePlan.operations.every(({ changeId }) => changeId === change.id),
  );
}

export class CreatePerChangeCleanupWorkflows {
  constructor(
    private readonly repository: CleanupWorkflowRepository,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(parent: CleanupWorkflow): Promise<readonly CleanupWorkflow[]> {
    if (parent.phase !== 'preflighted' || !parent.writePlan) {
      throw new Error('Per-change transactions require a preflighted cleanup workflow.');
    }
    const plans = splitContactWritePlanByChange(parent.writePlan);
    const acceptedById = new Map(
      parent.changeSet.changes
        .filter(({ decision }) => decision === 'accepted')
        .map((change) => [change.id, change]),
    );
    const existing = await this.loadExisting();
    const children: CleanupWorkflow[] = [];

    for (const plan of plans) {
      const change = acceptedById.get(plan.changeId);
      if (!change) throw new Error(`Accepted change ${plan.changeId} is unavailable.`);
      const changeSetId = childChangeSetId(parent, plan.changeId);
      const childPlan: ContactWritePlan = validateContactWritePlan({
        ...plan,
        changeSetId,
      });
      const saved = existing.find(({ changeSet }) => changeSet.id === changeSetId);
      if (saved) {
        if (saved.phase === 'reviewing') {
          const preflighted = recordWorkflowPreflight(
            saved,
            childPlan,
            this.clock.now().toISOString(),
          );
          await this.repository.save(preflighted, saved.revision);
          children.push(preflighted);
        } else {
          children.push(saved);
        }
        continue;
      }

      const createdAt = this.clock.now().toISOString();
      const changeSet = createChangeSet({
        id: changeSetId,
        snapshotId: parent.snapshotId,
        createdAt,
        changes: [change],
      });
      let child = createCleanupWorkflow({
        id: this.idGenerator.nextId(),
        source: parent.source,
        snapshotId: parent.snapshotId,
        backupId: parent.backupId,
        changeSet,
        createdAt,
      });
      await this.repository.save(child, null);
      child = recordWorkflowPreflight(child, childPlan, this.clock.now().toISOString());
      await this.repository.save(child, 0);
      children.push(child);
    }
    return Object.freeze(children);
  }

  private async loadExisting(): Promise<readonly CleanupWorkflow[]> {
    const summaries = this.repository.listAll
      ? await this.repository.listAll()
      : await this.repository.listResumable();
    const workflows = await Promise.all(summaries.map(({ id }) => this.repository.load(id)));
    return workflows.filter((workflow): workflow is CleanupWorkflow => Boolean(workflow));
  }
}
