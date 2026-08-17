import {
  compareContactSnapshots,
  createContactSnapshot,
  type CanonicalContact,
  type ContactSnapshot,
  type ContactSourceRef,
} from '@/domain';

const source: ContactSourceRef = { kind: 'device' };

function contact(id: string, name = id): CanonicalContact {
  return {
    id,
    recordRef: { source, sourceContactId: `source-${id}` },
    displayName: name,
    name: { givenName: name },
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
    createdAt: '2026-08-17T00:00:00.000Z',
    contacts,
  });
}

describe('contact snapshot delta', () => {
  it('tracks new, updated, deleted, and unchanged contacts by source identity', () => {
    const previous = snapshot('previous', [contact('same'), contact('updated', 'Old'), contact('deleted')]);
    const current = snapshot('current', [contact('same'), contact('updated', 'New'), contact('added')]);

    expect(compareContactSnapshots(previous, current)).toMatchObject({
      previousSnapshotId: 'previous',
      currentSnapshotId: 'current',
      hasBaseline: true,
      addedContactIds: ['added'],
      updatedContactIds: ['updated'],
      deletedContactIds: ['deleted'],
      unavailableContactIds: [],
      unchangedContactIds: ['same'],
      beautificationContactIds: ['added', 'updated'],
    });
  });

  it('treats every current contact as new when no backup exists', () => {
    expect(compareContactSnapshots(null, snapshot('first', [contact('b'), contact('a')]))).toMatchObject({
      hasBaseline: false,
      addedContactIds: ['a', 'b'],
      beautificationContactIds: ['a', 'b'],
    });
  });

  it('does not call hidden contacts deleted when access is limited', () => {
    const result = compareContactSnapshots(
      snapshot('previous', [contact('visible'), contact('hidden')]),
      snapshot('current', [contact('visible')], 'limited'),
    );
    expect(result.deletedContactIds).toEqual([]);
    expect(result.unavailableContactIds).toEqual(['hidden']);
  });

  it('rejects comparisons between different contact sources', () => {
    const previous = snapshot('previous', [contact('one')]);
    const current = createContactSnapshot({
      ...snapshot('current', []),
      source: { kind: 'google', accountId: 'account-1' },
    });
    expect(() => compareContactSnapshots(previous, current)).toThrow('different sources');
  });
});
