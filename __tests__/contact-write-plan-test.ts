import {
  compensationsForExecutedOperations,
  splitContactWritePlanByChange,
  ContactWritePlanError,
  createChangeSet,
  createConfidenceScore,
  createContactSnapshot,
  createDryRunContactWritePlan,
  type BackupManifest,
  type CanonicalContact,
  type ChangeSet,
  type ContactSnapshot,
  type ProposedChange,
} from '@/domain';
import { PrepareContactWrite } from '@/application';

const source = { kind: 'device' as const };
const at = '2026-08-17T15:00:00.000Z';

function contact(id: string, displayName = id): CanonicalContact {
  return {
    id,
    recordRef: { source, sourceContactId: `native-${id}` },
    displayName,
    name: { givenName: displayName },
    nicknames: [],
    phoneNumbers: [],
    emailAddresses: [],
    postalAddresses: [],
    organizations: [],
    urls: [],
    birthdays: [],
    events: [],
    notes: [],
    groups: [],
    photos: [],
    extensions: {},
  };
}

function snapshot(
  id: string,
  contacts: readonly CanonicalContact[],
  accessScope: 'all' | 'limited' = 'all',
): ContactSnapshot {
  return createContactSnapshot({
    id,
    schemaVersion: 1,
    source,
    accessScope,
    createdAt: at,
    contacts,
  });
}

function backup(analyzed: ContactSnapshot, overrides: Partial<BackupManifest> = {}): BackupManifest {
  return {
    id: 'backup-1',
    schemaVersion: 1,
    snapshotId: analyzed.id,
    snapshotCreatedAt: analyzed.createdAt,
    snapshotAccessScope: analyzed.accessScope,
    source,
    createdAt: at,
    contactCount: analyzed.contacts.length,
    chunkContactLimit: 100,
    chunks: [
      {
        index: 0,
        fileName: 'chunk-000000.cfb',
        contactCount: analyzed.contacts.length,
        encryptedSizeInBytes: 1,
        sha256: '0'.repeat(64),
      },
    ],
    artifact: { uri: 'test://backup', sizeInBytes: 1, sha256: '0'.repeat(64) },
    encryption: { algorithm: 'AES-256-GCM', keyAlias: 'test' },
    ...overrides,
  };
}

const common = {
  origin: 'user' as const,
  confidence: createConfidenceScore(1),
  reasons: ['Test decision'],
  decision: 'accepted' as const,
};

function changes(items: readonly ProposedChange[]): ChangeSet {
  return createChangeSet({
    id: 'changes-1',
    snapshotId: 'analyzed',
    createdAt: at,
    changes: items,
  });
}

describe('dry-run contact write plan', () => {
  const a = contact('a');
  const b = contact('b');
  const c = contact('c');
  const d = contact('d');
  const analyzed = snapshot('analyzed', [a, b, c, d]);

  const update: ProposedChange = {
    ...common,
    id: 'update-a',
    kind: 'update',
    contactId: 'a',
    before: a,
    after: { ...a, displayName: 'A updated', name: { givenName: 'A updated' } },
  };
  const remove: ProposedChange = {
    ...common,
    id: 'delete-b',
    kind: 'delete',
    contactId: 'b',
    before: b,
  };
  const merge: ProposedChange = {
    ...common,
    id: 'merge-c-d',
    kind: 'merge',
    contactIds: ['c', 'd'],
    before: [c, d],
    after: c,
    resolvedConflictFields: ['name'],
  };

  it('rejects an accepted merge whose structured conflict is unresolved', () => {
    const unresolved: ProposedChange = { ...merge, resolvedConflictFields: undefined };
    try {
      createDryRunContactWritePlan({
        analyzedSnapshot: analyzed,
        freshSnapshot: snapshot('fresh', [a, b, c, d]),
        backup: backup(analyzed),
        changeSet: changes([unresolved]),
        plannedAt: at,
      });
      throw new Error('Expected unresolved conflict rejection.');
    } catch (error) {
      expect(error).toMatchObject({ code: 'conflict-unresolved' });
    }
  });

  it('orders creates and updates before destructive deletes', () => {
    const plan = createDryRunContactWritePlan({
      analyzedSnapshot: analyzed,
      freshSnapshot: snapshot('fresh', [a, b, c, d]),
      backup: backup(analyzed),
      changeSet: changes([update, remove, merge]),
      plannedAt: at,
    });

    expect(plan.operations.map(({ kind }) => kind)).toEqual([
      'update',
      'update',
      'delete',
      'delete',
    ]);
    expect(plan).toMatchObject({ createCount: 0, updateCount: 2, deleteCount: 2 });
    expect(plan.compensations.map(({ kind }) => kind)).toEqual([
      'recreate-deleted',
      'recreate-deleted',
      'restore-update',
      'restore-update',
    ]);
  });

  it('creates a new merge target before deleting its source contacts', () => {
    const newTarget = { ...contact('new-target', c.displayName), name: c.name };
    const newMerge: ProposedChange = { ...merge, after: newTarget };
    const plan = createDryRunContactWritePlan({
      analyzedSnapshot: analyzed,
      freshSnapshot: snapshot('fresh', [a, b, c, d]),
      backup: backup(analyzed),
      changeSet: changes([newMerge]),
      plannedAt: at,
    });
    expect(plan.operations.map(({ kind }) => kind)).toEqual(['create', 'delete', 'delete']);
    expect(plan.operations[0]).toMatchObject({
      reconciliationMarker: 'contactifier://write/fresh/merge-c-d%3Acreate%3A0',
    });
  });

  it('selects only executed operations for partial-failure rollback', () => {
    const plan = createDryRunContactWritePlan({
      analyzedSnapshot: analyzed,
      freshSnapshot: snapshot('fresh', [a, b, c, d]),
      backup: backup(analyzed),
      changeSet: changes([update, remove]),
      plannedAt: at,
    });
    const executedIds = plan.operations.slice(0, 2).map(({ id }) => id);
    expect(
      compensationsForExecutedOperations(plan, executedIds).map(({ kind }) => kind),
    ).toEqual(['recreate-deleted', 'restore-update']);
  });

  it('creates an independently compensatable plan for every accepted change', () => {
    const plan = createDryRunContactWritePlan({
      analyzedSnapshot: analyzed,
      freshSnapshot: snapshot('fresh', [a, b, c, d]),
      backup: backup(analyzed),
      changeSet: changes([update, remove, merge]),
      plannedAt: at,
    });

    const transactions = splitContactWritePlanByChange(plan);

    expect(transactions.map(({ changeId }) => changeId)).toEqual([
      'update-a',
      'merge-c-d',
      'delete-b',
    ]);
    expect(transactions.map(({ transactionId }) => transactionId)).toEqual([
      `${plan.changeSetId}:update-a`,
      `${plan.changeSetId}:merge-c-d`,
      `${plan.changeSetId}:delete-b`,
    ]);
    expect(transactions.map(({ createCount, updateCount, deleteCount }) => ({
      createCount,
      updateCount,
      deleteCount,
    }))).toEqual([
      { createCount: 0, updateCount: 1, deleteCount: 0 },
      { createCount: 0, updateCount: 1, deleteCount: 1 },
      { createCount: 0, updateCount: 0, deleteCount: 1 },
    ]);
    for (const transaction of transactions) {
      expect(transaction.compensations).toHaveLength(transaction.operations.length);
      expect(new Set(transaction.operations.map(({ changeId }) => changeId))).toEqual(
        new Set([transaction.changeId]),
      );
    }
  });

  it('performs a fresh source read immediately before producing the plan', async () => {
    const fresh = snapshot('fresh-read', [a, b, c, d]);
    const readContactSource = {
      execute: jest.fn().mockResolvedValue(fresh),
    };
    const useCase = new PrepareContactWrite(
      readContactSource as never,
      { now: () => new Date(at) },
    );

    const plan = await useCase.execute({
      analyzedSnapshot: analyzed,
      backup: backup(analyzed),
      changeSet: changes([update]),
    });

    expect(readContactSource.execute).toHaveBeenCalledWith({ source });
    expect(plan.freshSnapshotId).toBe('fresh-read');
  });

  it('rejects a photographed contact unless verified backup metadata covers every photo', () => {
    const photographed = { ...a, photos: [{ uri: 'file:///photo-a.jpg' }] };
    const photographedUpdate: ProposedChange = {
      ...update,
      before: photographed,
      after: { ...photographed, displayName: 'Updated' },
    };
    const photographedAnalyzed = snapshot('analyzed', [photographed, b, c, d]);
    const input = {
      analyzedSnapshot: photographedAnalyzed,
      freshSnapshot: snapshot('fresh', [photographed, b, c, d]),
      backup: backup(photographedAnalyzed),
      changeSet: changes([photographedUpdate]),
      plannedAt: at,
    };

    expect(() => createDryRunContactWritePlan(input)).toThrow(
      expect.objectContaining({ code: 'photo-backup-incomplete' }),
    );
    expect(() => createDryRunContactWritePlan({
      ...input,
      backup: {
        ...input.backup,
        photoAssets: [{
          index: 0,
          assetId: `${photographed.id}:0`,
          contactId: photographed.id,
          photoIndex: 0,
          fileName: 'photo-000000.cfp',
          plaintextSizeInBytes: 128,
          encryptedSizeInBytes: 160,
          plaintextSha256: '3'.repeat(64),
          sha256: '4'.repeat(64),
        }],
        artifact: { ...input.backup.artifact, sizeInBytes: 161 },
      },
    })).not.toThrow();
  });

  it.each([
    [
      'stale contact',
      () =>
        createDryRunContactWritePlan({
          analyzedSnapshot: analyzed,
          freshSnapshot: snapshot('fresh', [contact('a', 'Changed'), b, c, d]),
          backup: backup(analyzed),
          changeSet: changes([update]),
          plannedAt: at,
        }),
      'stale-contact',
    ],
    [
      'wrong backup',
      () =>
        createDryRunContactWritePlan({
          analyzedSnapshot: analyzed,
          freshSnapshot: snapshot('fresh', [a, b, c, d]),
          backup: backup(analyzed, { snapshotId: 'other' }),
          changeSet: changes([update]),
          plannedAt: at,
        }),
      'backup-mismatch',
    ],
    [
      'limited access',
      () =>
        createDryRunContactWritePlan({
          analyzedSnapshot: analyzed,
          freshSnapshot: snapshot('fresh', [a, b, c, d], 'limited'),
          backup: backup(analyzed),
          changeSet: changes([update]),
          plannedAt: at,
        }),
      'limited-access',
    ],
    [
      'pending decision',
      () =>
        createDryRunContactWritePlan({
          analyzedSnapshot: analyzed,
          freshSnapshot: snapshot('fresh', [a, b, c, d]),
          backup: backup(analyzed),
          changeSet: changes([{ ...update, decision: 'pending' }]),
          plannedAt: at,
        }),
      'invalid-decision',
    ],
  ] as const)('rejects %s during preflight', (_label, operation, code) => {
    let error: unknown;
    try {
      operation();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ContactWritePlanError);
    expect((error as ContactWritePlanError).code).toBe(code);
  });
});
