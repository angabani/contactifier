import { prepareContactTransactionUndo, previewContactTransactionUndo } from '@/application';
import {
  createChangeSet,
  createCleanupWorkflow,
  createConfidenceScore,
  createContactSnapshot,
  recordWorkflowOperation,
  recordWorkflowPreflight,
  transitionCleanupWorkflow,
  type CanonicalContact,
  type CleanupWorkflow,
  type ContactWritePlan,
} from '@/domain';

const source = { kind: 'device' as const };
const times = Array.from({ length: 10 }, (_, index) => `2026-08-20T12:0${index}:00.000Z`);

function contact(id: string, name = id): CanonicalContact {
  return {
    id, recordRef: { source, sourceContactId: `native-${id}` }, displayName: name,
    name: { givenName: name }, nicknames: [], phoneNumbers: [], emailAddresses: [], postalAddresses: [],
    organizations: [], urls: [], birthdays: [], events: [], notes: [], groups: [], photos: [], extensions: {},
  };
}

function completedMerge(): CleanupWorkflow {
  const a = contact('a', 'A');
  const b = contact('b', 'B');
  const after = { ...a, displayName: 'A B', name: { givenName: 'A B' } };
  const changeSet = createChangeSet({
    id: 'parent:transaction:merge-a-b', snapshotId: 'snapshot', createdAt: times[0],
    changes: [{ id: 'merge-a-b', kind: 'merge', contactIds: [a.id, b.id], before: [a, b], after,
      origin: 'rule', confidence: createConfidenceScore(1), reasons: ['test'], decision: 'accepted' }],
  });
  const plan: ContactWritePlan = {
    mode: 'dry-run', changeSetId: changeSet.id, analyzedSnapshotId: 'snapshot', freshSnapshotId: 'fresh',
    backupId: 'backup', plannedAt: times[1],
    operations: [
      { id: 'merge:update:0', changeId: 'merge-a-b', kind: 'update', sourceContactId: 'native-a', before: a, after },
      { id: 'merge:delete:1', changeId: 'merge-a-b', kind: 'delete', sourceContactId: 'native-b', before: b },
    ],
    compensations: [
      { kind: 'recreate-deleted', operationId: 'merge:delete:1', contact: b },
      { kind: 'restore-update', operationId: 'merge:update:0', contact: a },
    ], createCount: 0, updateCount: 1, deleteCount: 1,
  };
  let workflow = createCleanupWorkflow({ id: 'transaction-1', source, snapshotId: 'snapshot', backupId: 'backup', changeSet, createdAt: times[0] });
  workflow = recordWorkflowPreflight(workflow, plan, times[1]);
  workflow = transitionCleanupWorkflow(workflow, 'applying', times[2]);
  workflow = recordWorkflowOperation(workflow, 'merge:update:0', 'started', times[3]);
  workflow = recordWorkflowOperation(workflow, 'merge:update:0', 'applied', times[4], { operationId: 'merge:update:0', sourceContactId: 'native-a' });
  workflow = recordWorkflowOperation(workflow, 'merge:delete:1', 'started', times[5]);
  workflow = recordWorkflowOperation(workflow, 'merge:delete:1', 'applied', times[6], { operationId: 'merge:delete:1', sourceContactId: 'native-b' });
  workflow = transitionCleanupWorkflow(workflow, 'verifying', times[7]);
  workflow = transitionCleanupWorkflow(workflow, 'finalizing', times[8]);
  return transitionCleanupWorkflow(workflow, 'completed', times[9]);
}

describe('contact transaction undo preview', () => {
  it('is ready only when the verified after-state is still exact', () => {
    const workflow = completedMerge();
    const after = workflow.changeSet.changes[0].kind === 'merge' ? workflow.changeSet.changes[0].after : contact('x');
    const currentSnapshot = createContactSnapshot({ id: 'current', schemaVersion: 1, source, accessScope: 'all', createdAt: times[9], contacts: [after] });
    const preview = previewContactTransactionUndo({ workflow, currentSnapshot, laterWorkflows: [] });
    expect(preview).toMatchObject({ ready: true, compensationCount: 2, blockReasons: [] });
    expect(preview.contactsToRestore.map(({ displayName }) => displayName)).toEqual(['A', 'B']);
  });

  it('blocks when the survivor changed or a deleted source identity reappeared', () => {
    const workflow = completedMerge();
    const currentSnapshot = createContactSnapshot({
      id: 'current', schemaVersion: 1, source, accessScope: 'all', createdAt: times[9],
      contacts: [contact('a', 'User changed A'), contact('b', 'Reappeared B')],
    });
    const preview = previewContactTransactionUndo({ workflow, currentSnapshot, laterWorkflows: [] });
    expect(preview.ready).toBe(false);
    expect(preview.blockReasons).toContain('after-state-changed');
    expect(preview.conflictingSourceContactIds).toEqual(['native-a', 'native-b']);
  });

  it('blocks a transaction when a later workflow touches one of its source identities', () => {
    const workflow = completedMerge();
    const after = workflow.changeSet.changes[0].kind === 'merge' ? workflow.changeSet.changes[0].after : contact('x');
    const currentSnapshot = createContactSnapshot({ id: 'current', schemaVersion: 1, source, accessScope: 'all', createdAt: times[9], contacts: [after] });
    const later = { ...workflow, id: 'transaction-2', updatedAt: '2026-08-20T13:00:00.000Z' };
    const preview = previewContactTransactionUndo({ workflow, currentSnapshot, laterWorkflows: [later] });
    expect(preview.ready).toBe(false);
    expect(preview.blockReasons).toContain('dependency');
    expect(preview.dependentWorkflowIds).toEqual(['transaction-2']);
  });
});

describe('contact transaction undo plan', () => {
  it('builds a separately journaled inverse merge with rollback for every step', () => {
    const workflow = completedMerge();
    const change = workflow.changeSet.changes[0];
    if (change.kind !== 'merge') throw new Error('Expected merge fixture.');
    const currentSnapshot = createContactSnapshot({
      id: 'undo-fresh', schemaVersion: 1, source, accessScope: 'all',
      createdAt: times[9], contacts: [change.after],
    });

    const prepared = prepareContactTransactionUndo({
      workflow, currentSnapshot, plannedAt: '2026-08-20T12:10:00.000Z',
    });

    expect(prepared.changeSet.id).toContain(':undo:transaction:');
    expect(prepared.writePlan).toMatchObject({
      analyzedSnapshotId: 'undo-fresh', freshSnapshotId: 'undo-fresh',
      createCount: 1, updateCount: 1, deleteCount: 0,
    });
    expect(prepared.writePlan.operations.map(({ kind }) => kind)).toEqual(['update', 'create']);
    expect(prepared.writePlan.compensations.map(({ kind }) => kind)).toEqual([
      'delete-created', 'restore-update',
    ]);
  });

  it('refuses to prepare inverse writes when the verified after-state is stale', () => {
    const workflow = completedMerge();
    const currentSnapshot = createContactSnapshot({
      id: 'undo-stale', schemaVersion: 1, source, accessScope: 'all',
      createdAt: times[9], contacts: [contact('a', 'Changed after preview')],
    });

    expect(() => prepareContactTransactionUndo({
      workflow, currentSnapshot, plannedAt: '2026-08-20T12:10:00.000Z',
    })).toThrow('changed after the original transaction');
  });
});
