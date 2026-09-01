import { createIosPhotoRoundTripEvidence } from '@/features/developer/ios-certification-photo-evidence';
import { createConfidenceScore, type CanonicalContact, type CleanupWorkflow } from '@/domain';

function completedPhotoRestore(): CleanupWorkflow {
  const contact: CanonicalContact = {
    id: 'photo-contact', recordRef: { source: { kind: 'device' }, sourceContactId: 'old-native' },
    displayName: '[Contactifier Test] Photo', name: { givenName: '[Contactifier Test] Photo' },
    nicknames: [], phoneNumbers: [], emailAddresses: [], postalAddresses: [], organizations: [],
    urls: [{ id: 'marker', value: 'contactifier://certification-fixture/set/photo', origin: 'source' }],
    birthdays: [], events: [], notes: [], groups: [],
    photos: [{ uri: 'backup://photo', assetId: 'asset-photo' }], extensions: {},
  };
  return {
    id: 'photo-workflow', schemaVersion: 1, revision: 6, phase: 'completed', source: { kind: 'device' },
    snapshotId: 'snapshot', backupId: 'backup', createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:03:00.000Z',
    changeSet: { id: 'backup:restore:photo', snapshotId: 'snapshot', createdAt: '2026-08-31T00:00:00.000Z', changes: [{
      id: 'recreate', kind: 'update', contactId: contact.id, before: contact, after: contact,
      origin: 'rule', confidence: createConfidenceScore(1),
      reasons: ['restore'], decision: 'accepted',
    }] },
    writePlan: {
      mode: 'dry-run', changeSetId: 'backup:restore:photo', analyzedSnapshotId: 'snapshot',
      freshSnapshotId: 'fresh', backupId: 'backup', plannedAt: '2026-08-31T00:01:00.000Z',
      operations: [{ id: 'create-photo', changeId: 'recreate', kind: 'create', contact,
        reconciliationMarker: 'contactifier://write/fresh/create-photo' }],
      compensations: [{ kind: 'delete-created', operationId: 'create-photo' }],
      createCount: 1, updateCount: 0, deleteCount: 0,
    },
    journal: [{ operationId: 'create-photo', outcome: 'applied', recordedAt: '2026-08-31T00:02:00.000Z',
      receipt: { operationId: 'create-photo', sourceContactId: 'new-native' } }],
  };
}

describe('iOS photo round-trip evidence', () => {
  it('binds equal byte hashes to the authenticated asset and exact native receipt', () => {
    const hash = 'a'.repeat(64);
    expect(createIosPhotoRoundTripEvidence({
      workflow: completedPhotoRestore(), operationId: 'create-photo', assetId: 'asset-photo',
      nativeContactId: 'new-native', expectedSha256: hash, actualSha256: hash,
      observedAt: '2026-08-31T00:04:00.000Z',
    })).toEqual(expect.objectContaining({ expectedSha256: hash, actualSha256: hash }));
  });

  it('rejects different bytes and a native contact not named by the receipt', () => {
    const common = {
      workflow: completedPhotoRestore(), operationId: 'create-photo', assetId: 'asset-photo',
      nativeContactId: 'new-native', expectedSha256: 'a'.repeat(64),
      actualSha256: 'b'.repeat(64), observedAt: '2026-08-31T00:04:00.000Z',
    };
    expect(() => createIosPhotoRoundTripEvidence(common)).toThrow('differ');
    expect(() => createIosPhotoRoundTripEvidence({
      ...common, actualSha256: 'a'.repeat(64), nativeContactId: 'another-native',
    })).toThrow('receipt');
  });
});
