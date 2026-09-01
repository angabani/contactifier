import { createIosPermissionDenialEvidence } from '@/features/developer/ios-certification-permission-evidence';
import { createConfidenceScore, type CanonicalContact, type CleanupWorkflow } from '@/domain';

function workflow(): CleanupWorkflow {
  const contact: CanonicalContact = {
    id: 'fixture', recordRef: { source: { kind: 'device' }, sourceContactId: 'native-fixture' },
    displayName: '[Contactifier Test] Permission', name: { givenName: '[Contactifier Test] Permission' },
    nicknames: [], phoneNumbers: [], emailAddresses: [], postalAddresses: [], organizations: [],
    urls: [{ id: 'marker', label: 'fixture', value: 'contactifier://certification-fixture/set/permission', origin: 'source' }],
    birthdays: [], events: [], notes: [], groups: [], photos: [], extensions: {},
  };
  return {
    id: 'workflow', schemaVersion: 1, revision: 2, phase: 'preflighted', source: { kind: 'device' },
    snapshotId: 'snapshot', backupId: 'backup', createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:01:00.000Z',
    changeSet: { id: 'changes', snapshotId: 'snapshot', createdAt: '2026-08-31T00:00:00.000Z', changes: [{
      id: 'update', kind: 'update', contactId: contact.id, before: contact, after: contact,
      origin: 'rule', confidence: createConfidenceScore(1), reasons: ['fixture'], decision: 'accepted',
    }] },
    writePlan: {
      mode: 'dry-run', changeSetId: 'changes', analyzedSnapshotId: 'snapshot', freshSnapshotId: 'fresh',
      backupId: 'backup', plannedAt: '2026-08-31T00:01:00.000Z', operations: [{
        id: 'operation', changeId: 'update', kind: 'update', sourceContactId: 'native-fixture',
        before: contact, after: contact,
      }], compensations: [{ kind: 'restore-update', operationId: 'operation', contact }],
      createCount: 0, updateCount: 1, deleteCount: 0,
    },
    journal: [],
  };
}

describe('iOS permission denial evidence', () => {
  it('records an exact full-access denial only when durable workflow state is unchanged', () => {
    const before = workflow();
    expect(createIosPermissionDenialEvidence({
      before, after: { ...before }, denialReasons: ['full-access-required'],
      observedAt: '2026-08-31T00:02:00.000Z',
    })).toEqual(expect.objectContaining({
      workflowId: 'workflow', denialReason: 'full-access-required', revisionBefore: 2, revisionAfter: 2,
    }));
  });

  it('rejects changed state and mixed denial causes', () => {
    const before = workflow();
    expect(() => createIosPermissionDenialEvidence({
      before, after: { ...before, revision: 3 }, denialReasons: ['full-access-required'],
      observedAt: '2026-08-31T00:02:00.000Z',
    })).toThrow('changed');
    expect(() => createIosPermissionDenialEvidence({
      before, after: before, denialReasons: ['full-access-required', 'confirmation-required'],
      observedAt: '2026-08-31T00:02:00.000Z',
    })).toThrow('solely');
  });
});
