import { getCompletedTransactionResultContactId } from '@/application';
import { createConfidenceScore, type CleanupWorkflow, type ProposedChange } from '@/domain';

function workflow(overrides: Partial<CleanupWorkflow> = {}): CleanupWorkflow {
  const contact = {
    id: 'a', recordRef: { source: { kind: 'device' as const }, sourceContactId: 'native-a' },
    displayName: 'A', name: { givenName: 'A' }, nicknames: [], phoneNumbers: [], emailAddresses: [],
    postalAddresses: [], organizations: [], urls: [], birthdays: [], events: [], notes: [], groups: [],
    photos: [], extensions: {},
  };
  return {
    id: 'transaction', schemaVersion: 1, revision: 4, phase: 'completed', source: { kind: 'device' },
    snapshotId: 'snapshot', backupId: 'backup', createdAt: '2026-08-20T12:00:00.000Z',
    updatedAt: '2026-08-20T12:04:00.000Z',
    changeSet: {
      id: 'changes', snapshotId: 'snapshot', createdAt: '2026-08-20T12:00:00.000Z',
      changes: [{ id: 'update-a', kind: 'update', contactId: 'a', before: contact, after: contact,
        origin: 'rule', confidence: createConfidenceScore(1), reasons: ['test'], decision: 'accepted' }],
    },
    writePlan: {
      mode: 'dry-run', changeSetId: 'changes', analyzedSnapshotId: 'snapshot', freshSnapshotId: 'fresh',
      backupId: 'backup', plannedAt: '2026-08-20T12:01:00.000Z',
      operations: [{ id: 'update-a:update:0', changeId: 'update-a', kind: 'update',
        sourceContactId: 'native-a', before: contact, after: contact }],
      compensations: [{ kind: 'restore-update', operationId: 'update-a:update:0', contact }],
      createCount: 0, updateCount: 1, deleteCount: 0,
    },
    journal: [
      { operationId: 'update-a:update:0', outcome: 'started', recordedAt: '2026-08-20T12:02:00.000Z' },
      { operationId: 'update-a:update:0', outcome: 'applied', recordedAt: '2026-08-20T12:03:00.000Z',
        receipt: { operationId: 'update-a:update:0', sourceContactId: 'native-result' } },
    ],
    ...overrides,
  };
}

describe('completed transaction result contact id', () => {
  it('uses the durable native write receipt for an update result', () => {
    expect(getCompletedTransactionResultContactId(workflow())).toBe('native-result');
  });

  it('prefers the finalized native id for a created merge result', () => {
    const base = workflow();
    const update = base.changeSet.changes[0];
    if (update.kind !== 'update') throw new Error('Expected update fixture.');
    const marker = 'contactifier://write/fresh/create-result';
    expect(getCompletedTransactionResultContactId({
      ...base,
      writePlan: {
        ...base.writePlan!,
        operations: [{ id: 'create-result', changeId: 'update-a', kind: 'create',
          contact: update.after, reconciliationMarker: marker }],
      },
      journal: [
        { operationId: 'create-result', outcome: 'started', recordedAt: '2026-08-20T12:02:00.000Z' },
        { operationId: 'create-result', outcome: 'applied', recordedAt: '2026-08-20T12:03:00.000Z',
          receipt: { operationId: 'create-result', sourceContactId: 'native-before-finalization' } },
        { operationId: 'create-result', outcome: 'finalization-started', recordedAt: '2026-08-20T12:03:30.000Z' },
        { operationId: 'create-result', outcome: 'finalized', recordedAt: '2026-08-20T12:04:00.000Z',
          finalizationReceipt: { operationId: 'create-result', sourceContactId: 'native-finalized',
            removedReconciliationMarker: marker } },
      ],
    })).toBe('native-finalized');
  });

  it('never opens an unfinalized created contact from only an apply receipt', () => {
    const base = workflow();
    const update = base.changeSet.changes[0];
    if (update.kind !== 'update') throw new Error('Expected update fixture.');
    expect(getCompletedTransactionResultContactId({
      ...base,
      writePlan: {
        ...base.writePlan!,
        operations: [{ id: 'create-result', changeId: 'update-a', kind: 'create',
          contact: update.after, reconciliationMarker: 'contactifier://write/fresh/create-result' }],
      },
      journal: [
        { operationId: 'create-result', outcome: 'started', recordedAt: '2026-08-20T12:02:00.000Z' },
        { operationId: 'create-result', outcome: 'applied', recordedAt: '2026-08-20T12:03:00.000Z',
          receipt: { operationId: 'create-result', sourceContactId: 'native-with-marker' } },
      ],
    })).toBeNull();
  });

  it('does not expose a result for unfinished or delete-only transactions', () => {
    expect(getCompletedTransactionResultContactId(workflow({ phase: 'verifying' }))).toBeNull();
    const base = workflow();
    const update = base.changeSet.changes[0];
    if (update.kind !== 'update') throw new Error('Expected update fixture.');
    const deletion: ProposedChange = {
      id: 'delete-a', kind: 'delete', contactId: 'a', before: update.before,
      origin: 'rule', confidence: createConfidenceScore(1), reasons: ['test'], decision: 'accepted',
    };
    expect(getCompletedTransactionResultContactId({
      ...base,
      changeSet: { ...base.changeSet, changes: [deletion] },
      writePlan: { ...base.writePlan!, operations: [{ id: 'delete-a', changeId: 'delete-a', kind: 'delete',
        sourceContactId: 'native-a', before: update.before }] },
    })).toBeNull();
  });
});
