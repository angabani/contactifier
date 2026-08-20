import { createContactWriteConfirmation } from '@/application';
import { createConfidenceScore, type CanonicalContact, type ChangeSet, type ContactWritePlan } from '@/domain';

function contact(id: string): CanonicalContact {
  return {
    id,
    recordRef: { source: { kind: 'device' }, sourceContactId: id },
    displayName: id,
    name: { givenName: id },
    nicknames: [], phoneNumbers: [], emailAddresses: [], postalAddresses: [],
    organizations: [], urls: [], birthdays: [], events: [], notes: [], groups: [], photos: [],
    extensions: {},
  };
}

describe('contact write confirmation', () => {
  it('summarizes impact and requires the exact verified backup', () => {
    const before = contact('before');
    const after = contact('after');
    const changeSet: ChangeSet = {
      id: 'changes',
      snapshotId: 'snapshot',
      createdAt: '2026-08-20T00:00:00.000Z',
      changes: [
        { id: 'accepted', kind: 'update', origin: 'rule', confidence: createConfidenceScore(1), reasons: [], decision: 'accepted', contactId: before.id, before, after },
        { id: 'later', kind: 'delete', origin: 'rule', confidence: createConfidenceScore(1), reasons: [], decision: 'skipped', contactId: before.id, before },
      ],
    };
    const plan: ContactWritePlan = {
      mode: 'dry-run', changeSetId: changeSet.id, analyzedSnapshotId: 'snapshot',
      freshSnapshotId: 'fresh', backupId: 'backup', plannedAt: '2026-08-20T00:01:00.000Z',
      operations: [], compensations: [], createCount: 1, updateCount: 2, deleteCount: 1,
    };

    expect(createContactWriteConfirmation({ changeSet, plan, verifiedBackupId: 'backup' })).toEqual({
      acceptedTransactionCount: 1,
      createCount: 1,
      updateCount: 2,
      deleteCount: 1,
      rollbackStepCount: 0,
      hasVerifiedBackup: true,
      hasDestructiveImpact: true,
    });
    expect(createContactWriteConfirmation({ changeSet, plan, verifiedBackupId: 'other' }).hasVerifiedBackup)
      .toBe(false);
  });
});
