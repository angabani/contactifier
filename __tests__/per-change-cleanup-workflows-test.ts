import {
  CleanupWorkflowConflictError,
  CreatePerChangeCleanupWorkflows,
  isPerChangeCleanupWorkflow,
  type CleanupWorkflowRepository,
  type CleanupWorkflowSummary,
} from '@/application';
import {
  createChangeSet,
  createConfidenceScore,
  createCleanupWorkflow,
  recordWorkflowPreflight,
  type CanonicalContact,
  type CleanupWorkflow,
  type ContactWritePlan,
  type ProposedChange,
} from '@/domain';

const at = '2026-08-20T12:00:00.000Z';
const source = { kind: 'device' as const };

function contact(id: string): CanonicalContact {
  return {
    id,
    recordRef: { source, sourceContactId: `native-${id}` },
    displayName: id,
    name: { givenName: id },
    nicknames: [], phoneNumbers: [], emailAddresses: [], postalAddresses: [],
    organizations: [], urls: [], birthdays: [], events: [], notes: [], groups: [], photos: [], extensions: {},
  };
}

class MemoryRepository implements CleanupWorkflowRepository {
  readonly values = new Map<string, CleanupWorkflow>();
  load(id: string) { return Promise.resolve(this.values.get(id) ?? null); }
  listResumable() { return this.listAll(); }
  listAll(): Promise<readonly CleanupWorkflowSummary[]> {
    return Promise.resolve([...this.values.values()].map(({ id, revision, phase, createdAt, updatedAt }) => ({
      id, revision, phase, createdAt, updatedAt,
    })));
  }
  discard() { return Promise.resolve(); }
  save(next: CleanupWorkflow, expected: number | null) {
    const current = this.values.get(next.id);
    if ((expected === null && current) || (expected !== null && current?.revision !== expected)) {
      throw new CleanupWorkflowConflictError(next.id);
    }
    this.values.set(next.id, next);
    return Promise.resolve();
  }
}

describe('per-change cleanup workflows', () => {
  it('persists one resumable preflighted child per accepted change without duplication', async () => {
    const a = contact('a');
    const b = contact('b');
    const changes: ProposedChange[] = [
      { id: 'update-a', kind: 'update', contactId: a.id, before: a, after: { ...a, displayName: 'A' }, origin: 'rule', confidence: createConfidenceScore(1), reasons: ['test'], decision: 'accepted' },
      { id: 'delete-b', kind: 'delete', contactId: b.id, before: b, origin: 'rule', confidence: createConfidenceScore(1), reasons: ['test'], decision: 'accepted' },
    ];
    const changeSet = createChangeSet({ id: 'parent-changes', snapshotId: 'snapshot', createdAt: at, changes });
    const plan: ContactWritePlan = {
      mode: 'dry-run', changeSetId: changeSet.id, analyzedSnapshotId: 'snapshot', freshSnapshotId: 'fresh', backupId: 'backup', plannedAt: at,
      operations: [
        { id: 'update-a:update:0', changeId: 'update-a', kind: 'update', sourceContactId: 'native-a', before: a, after: { ...a, displayName: 'A' } },
        { id: 'delete-b:delete:0', changeId: 'delete-b', kind: 'delete', sourceContactId: 'native-b', before: b },
      ],
      compensations: [
        { kind: 'recreate-deleted', operationId: 'delete-b:delete:0', contact: b },
        { kind: 'restore-update', operationId: 'update-a:update:0', contact: a },
      ],
      createCount: 0, updateCount: 1, deleteCount: 1,
    };
    const parent = recordWorkflowPreflight(createCleanupWorkflow({
      id: 'parent', source, snapshotId: 'snapshot', backupId: 'backup', changeSet, createdAt: at,
    }), plan, at);
    const repository = new MemoryRepository();
    let nextId = 0;
    const useCase = new CreatePerChangeCleanupWorkflows(
      repository,
      { now: () => new Date(at) },
      { nextId: () => `child-${++nextId}` },
    );

    const first = await useCase.execute(parent);
    const second = await useCase.execute(parent);

    expect(first).toHaveLength(2);
    expect(second.map(({ id }) => id)).toEqual(first.map(({ id }) => id));
    expect(repository.values.size).toBe(2);
    expect(first.every(({ phase, changeSet: childSet, writePlan }) =>
      phase === 'preflighted' && childSet.changes.length === 1 && writePlan?.operations.length === 1,
    )).toBe(true);
    expect(first.every(isPerChangeCleanupWorkflow)).toBe(true);
    expect(isPerChangeCleanupWorkflow(parent)).toBe(false);
  });
});
