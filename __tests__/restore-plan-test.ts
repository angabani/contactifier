import {
  contactsSemanticallyEqual,
  createContactRestorePlan,
  type CanonicalContact,
  type ContactSnapshot,
} from '@/domain';

function contact(id: string, displayName = id): CanonicalContact {
  const source = { kind: 'device' as const };
  return {
    id: `canonical:${id}`,
    recordRef: { source, sourceContactId: id },
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
  return {
    id,
    schemaVersion: 1,
    source: { kind: 'device' },
    accessScope,
    createdAt: '2026-08-17T00:00:00.000Z',
    contacts,
  };
}

describe('contact restore planning', () => {
  it('ignores native value IDs and ordering when comparing semantics', () => {
    const left = {
      ...contact('one'),
      emailAddresses: [
        { id: 'old-a', value: 'a@example.com', origin: 'source' as const },
        { id: 'old-b', value: 'b@example.com', origin: 'source' as const },
      ],
    };
    const right = {
      ...contact('one'),
      emailAddresses: [
        { id: 'new-b', value: 'b@example.com', origin: 'source' as const },
        { id: 'new-a', value: 'a@example.com', origin: 'source' as const },
      ],
    };

    expect(contactsSemanticallyEqual(left, right)).toBe(true);
  });

  it('ignores temporary photo URIs until photo-byte restoration is supported', () => {
    const backup = { ...contact('one'), photos: [{ uri: 'file:///old-temporary-photo.jpg' }] };
    const current = { ...contact('one'), photos: [{ uri: 'file:///new-temporary-photo.jpg' }] };

    expect(contactsSemanticallyEqual(backup, current)).toBe(true);
    expect(
      createContactRestorePlan(snapshot('backup', [backup]), snapshot('current', [current]))
        .unchangedCount,
    ).toBe(1);
  });

  it('ignores OS formatting differences in phones, emails, labels, and whitespace', () => {
    const backup = {
      ...contact('one'),
      phoneNumbers: [
        {
          id: 'phone-old',
          value: { raw: '+1 (212) 555-0100' },
          label: ' Mobile ',
          origin: 'source' as const,
        },
      ],
      emailAddresses: [
        {
          id: 'email-old',
          value: ' Ada@Example.com ',
          label: 'WORK',
          origin: 'source' as const,
        },
      ],
    };
    const current = {
      ...contact('one'),
      phoneNumbers: [
        {
          id: 'phone-new',
          value: { raw: '+12125550100' },
          label: 'mobile',
          origin: 'source' as const,
        },
      ],
      emailAddresses: [
        {
          id: 'email-new',
          value: 'ada@example.COM',
          label: 'work',
          origin: 'source' as const,
        },
      ],
    };

    expect(contactsSemanticallyEqual(backup, current)).toBe(true);
  });

  it('classifies unchanged, changed, and missing contacts without touching additions', () => {
    const backup = snapshot('backup', [contact('same'), contact('changed'), contact('missing')]);
    const current = snapshot('current', [
      contact('same'),
      contact('changed', 'Changed name'),
      contact('added-later'),
    ]);

    const plan = createContactRestorePlan(backup, current);

    expect(plan.unchangedCount).toBe(1);
    expect(plan.updateCount).toBe(1);
    expect(plan.recreateCount).toBe(1);
    expect(plan.unavailableCount).toBe(0);
    expect(plan.items.map(({ kind }) => kind)).toEqual(['unchanged', 'update', 'recreate']);
  });

  it('never treats a missing contact as deleted under limited access', () => {
    const plan = createContactRestorePlan(
      snapshot('backup', [contact('hidden')]),
      snapshot('current', [], 'limited'),
    );

    expect(plan.recreateCount).toBe(0);
    expect(plan.unavailableCount).toBe(1);
    expect(plan.affectedContactIds).toEqual([]);
  });

  it('rejects restore comparisons across different sources', () => {
    const current = {
      ...snapshot('current', []),
      source: { kind: 'google' as const, accountId: 'account-1' },
    };
    expect(() => createContactRestorePlan(snapshot('backup', []), current)).toThrow(
      'same contact source',
    );
  });
});
