import {
  CleanupWorkflowConflictError,
  DiscardCleanupWorkflow,
  ManageCleanupWorkflow,
  ResumeCleanupWorkflow,
  type CleanupWorkflowRepository,
  type CleanupWorkflowSummary,
  type VerifiedBackupStore,
} from '@/application';
import {
  CleanupWorkflowTransitionError,
  createChangeSet,
  createCleanupWorkflow,
  recordWorkflowPreflight,
  recordWorkflowOperation,
  transitionCleanupWorkflow,
  validateCleanupWorkflow,
  type ChangeSet,
  type CleanupWorkflow,
  type ContactWritePlan,
  type BackupManifest,
} from '@/domain';

const source = { kind: 'device' as const };
const at = '2026-08-17T10:00:00.000Z';
const later = '2026-08-17T10:01:00.000Z';

function changeSet(): ChangeSet {
  return createChangeSet({ id: 'changes-1', snapshotId: 'snapshot-1', createdAt: at, changes: [] });
}

function workflow(): CleanupWorkflow {
  return createCleanupWorkflow({
    id: 'workflow-1',
    source,
    snapshotId: 'snapshot-1',
    backupId: 'backup-1',
    changeSet: changeSet(),
    createdAt: at,
  });
}

function writePlan(): ContactWritePlan {
  return {
    mode: 'dry-run',
    changeSetId: 'changes-1',
    analyzedSnapshotId: 'snapshot-1',
    freshSnapshotId: 'snapshot-2',
    backupId: 'backup-1',
    plannedAt: later,
    operations: [],
    compensations: [],
    createCount: 0,
    updateCount: 0,
    deleteCount: 0,
  };
}

class MemoryWorkflowRepository implements CleanupWorkflowRepository {
  private readonly workflows = new Map<string, CleanupWorkflow>();

  load(id: string): Promise<CleanupWorkflow | null> {
    return Promise.resolve(this.workflows.get(id) ?? null);
  }

  discard(id: string, expectedRevision: number | null): Promise<void> {
    const current = this.workflows.get(id);
    if (
      (expectedRevision === null && current) ||
      (expectedRevision !== null && current?.revision !== expectedRevision)
    ) {
      throw new CleanupWorkflowConflictError(id);
    }
    this.workflows.delete(id);
    return Promise.resolve();
  }

  listResumable(): Promise<readonly CleanupWorkflowSummary[]> {
    return Promise.resolve(
      [...this.workflows.values()]
        .filter(({ phase }) => phase !== 'completed' && phase !== 'rolled-back')
        .map(({ id, revision, phase, createdAt, updatedAt }) => ({
          id,
          revision,
          phase,
          createdAt,
          updatedAt,
        })),
    );
  }

  save(next: CleanupWorkflow, expectedRevision: number | null): Promise<void> {
    const current = this.workflows.get(next.id);
    if (
      (expectedRevision === null && current) ||
      (expectedRevision !== null && current?.revision !== expectedRevision) ||
      next.revision !== (expectedRevision === null ? 0 : expectedRevision + 1)
    ) {
      throw new CleanupWorkflowConflictError(next.id);
    }
    this.workflows.set(next.id, next);
    return Promise.resolve();
  }
}

function backupManifest(): BackupManifest {
  return {
    id: 'backup-1',
    schemaVersion: 1,
    snapshotId: 'snapshot-1',
    snapshotCreatedAt: at,
    snapshotAccessScope: 'all',
    source,
    createdAt: at,
    contactCount: 0,
    chunkContactLimit: 100,
    chunks: [],
    artifact: { uri: 'test://backup-1', sizeInBytes: 0, sha256: '0'.repeat(64) },
    encryption: { algorithm: 'AES-256-GCM', keyAlias: 'test-key' },
  };
}

describe('cleanup workflow', () => {
  it('enforces the preflight, apply, verify, and completion sequence', () => {
    const preflighted = recordWorkflowPreflight(workflow(), writePlan(), later);
    const applying = transitionCleanupWorkflow(preflighted, 'applying', later);
    const verifying = transitionCleanupWorkflow(applying, 'verifying', later);
    const finalizing = transitionCleanupWorkflow(verifying, 'finalizing', later);
    const completed = transitionCleanupWorkflow(finalizing, 'completed', later);

    expect(completed).toMatchObject({ phase: 'completed', revision: 5 });
    expect(() => transitionCleanupWorkflow(completed, 'applying', later)).toThrow(
      CleanupWorkflowTransitionError,
    );
  });

  it('retains the exact plan through failure and rollback', () => {
    const plan = writePlan();
    const preflighted = recordWorkflowPreflight(workflow(), plan, later);
    const applying = transitionCleanupWorkflow(preflighted, 'applying', later);
    const failed = transitionCleanupWorkflow(applying, 'failed', later, {
      code: 'native-write-failed',
      recoverable: true,
    });
    const rollingBack = transitionCleanupWorkflow(failed, 'rolling-back', later);
    const rolledBack = transitionCleanupWorkflow(rollingBack, 'rolled-back', later);

    expect(failed.failure?.failedFrom).toBe('applying');
    expect(rolledBack.writePlan).toBe(plan);
    expect(rolledBack.phase).toBe('rolled-back');
  });

  it('rejects unsafe identifiers and inconsistent persisted plans', () => {
    expect(() => validateCleanupWorkflow({ ...workflow(), id: '../escape' })).toThrow();
    expect(() =>
      validateCleanupWorkflow({
        ...workflow(),
        phase: 'preflighted',
        writePlan: { ...writePlan(), createCount: 1 },
      }),
    ).toThrow('operation counts');
  });

  it('rejects journal entries that do not reference the prepared plan', () => {
    const preflighted = recordWorkflowPreflight(workflow(), writePlan(), later);
    const applying = transitionCleanupWorkflow(preflighted, 'applying', later);
    expect(() => recordWorkflowOperation(applying, 'unknown-operation', 'applied', later)).toThrow(
      'unknown operation',
    );
  });

  it('uses optimistic revisions to reject stale checkpoints', async () => {
    const repository = new MemoryWorkflowRepository();
    const manager = new ManageCleanupWorkflow(
      repository,
      { now: () => new Date(at) },
      { nextId: () => 'workflow-1' },
    );
    const started = await manager.start({
      source,
      snapshotId: 'snapshot-1',
      backupId: 'backup-1',
      changeSet: changeSet(),
    });
    const next = recordWorkflowPreflight(started, writePlan(), later);
    await manager.checkpoint(next, 0);

    await expect(manager.checkpoint(next, 0)).rejects.toBeInstanceOf(
      CleanupWorkflowConflictError,
    );
    await expect(manager.listResumable()).resolves.toEqual([
      expect.objectContaining({ id: 'workflow-1', revision: 1, phase: 'preflighted' }),
    ]);
  });

  it('resumes only from the workflow exact verified backup', async () => {
    const repository = new MemoryWorkflowRepository();
    await repository.save(workflow(), null);
    const backup = backupManifest();
    const backupStore: VerifiedBackupStore = {
      listVerifiedBackups: () => Promise.resolve([backup]),
      readVerifiedBackup: async function* () {
        yield [];
      },
      createVerifiedBackup: () => Promise.reject(new Error('Not used')),
    };
    const resumed = await new ResumeCleanupWorkflow(repository, backupStore).execute('workflow-1');

    expect(resumed.workflow.id).toBe('workflow-1');
    expect(resumed.backup.id).toBe('backup-1');
    expect(resumed.snapshot).toMatchObject({ id: 'snapshot-1', contacts: [] });
  });

  it('refuses resume when the exact backup is unavailable', async () => {
    const repository = new MemoryWorkflowRepository();
    await repository.save(workflow(), null);
    const backupStore: VerifiedBackupStore = {
      listVerifiedBackups: () => Promise.resolve([]),
      readVerifiedBackup: async function* () {
        yield [];
      },
      createVerifiedBackup: () => Promise.reject(new Error('Not used')),
    };

    await expect(
      new ResumeCleanupWorkflow(repository, backupStore).execute('workflow-1'),
    ).rejects.toMatchObject({ code: 'backup-unavailable' });
  });

  it('discards review progress without involving backup storage', async () => {
    const repository = new MemoryWorkflowRepository();
    await repository.save(workflow(), null);

    await new DiscardCleanupWorkflow(repository).execute('workflow-1');

    await expect(repository.load('workflow-1')).resolves.toBeNull();
  });

  it('discards unreadable review progress using its non-secret revision metadata', async () => {
    let discarded: { id: string; revision: number | null } | undefined;
    const repository: CleanupWorkflowRepository = {
      load: () => Promise.reject(new Error('Encryption key unavailable')),
      listResumable: () => Promise.resolve([]),
      listAll: () => Promise.resolve([{
        id: 'workflow-1', revision: 3, phase: 'reviewing', createdAt: at, updatedAt: later,
      }]),
      discard: (id, revision) => {
        discarded = { id, revision };
        return Promise.resolve();
      },
      save: () => Promise.reject(new Error('Not used')),
    };

    await new DiscardCleanupWorkflow(repository).execute('workflow-1');

    expect(discarded).toEqual({ id: 'workflow-1', revision: 3 });
  });

  it('protects workflows that may have an active native operation', async () => {
    const repository = new MemoryWorkflowRepository();
    const initial = workflow();
    await repository.save(initial, null);
    const preflighted = recordWorkflowPreflight(initial, writePlan(), later);
    await repository.save(preflighted, 0);
    const applying = transitionCleanupWorkflow(preflighted, 'applying', later);
    await repository.save(applying, 1);

    await expect(
      new DiscardCleanupWorkflow(repository).execute('workflow-1'),
    ).rejects.toMatchObject({ code: 'active-operation' });
    await expect(repository.load('workflow-1')).resolves.toMatchObject({ phase: 'applying' });
  });
});
