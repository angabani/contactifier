import {
  analyzeExactDuplicates,
  normalizeEmailForExactMatch,
  normalizePhoneForExactMatch,
  type CanonicalContact,
  type ContactSnapshot,
} from '@/domain';

function contact(
  id: string,
  phoneNumbers: readonly string[] = [],
  emailAddresses: readonly string[] = [],
): CanonicalContact {
  const source = { kind: 'device' as const };
  return {
    id,
    recordRef: { source, sourceContactId: id },
    displayName: id,
    nicknames: [],
    phoneNumbers: phoneNumbers.map((raw, index) => ({
      id: `${id}:phone:${index}`,
      value: { raw },
      origin: 'source',
    })),
    emailAddresses: emailAddresses.map((value, index) => ({
      id: `${id}:email:${index}`,
      value,
      origin: 'source',
    })),
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

function snapshot(contacts: readonly CanonicalContact[]): ContactSnapshot {
  return {
    id: 'snapshot-1',
    schemaVersion: 1,
    source: { kind: 'device' },
    createdAt: '2026-08-17T00:00:00.000Z',
    contacts,
  };
}

describe('exact duplicate analysis', () => {
  it('normalizes email case and common phone formatting', () => {
    expect(normalizeEmailForExactMatch(' Ada@Example.COM ')).toBe('ada@example.com');
    expect(normalizePhoneForExactMatch({ raw: '(212) 555-0100' })).toBe('2125550100');
  });

  it('preserves an explicit international prefix and ignores short numbers', () => {
    expect(normalizePhoneForExactMatch({ raw: '+1 (212) 555-0100' })).toBe('+12125550100');
    expect(normalizePhoneForExactMatch({ raw: '555-0100' })).toBe('5550100');
    expect(normalizePhoneForExactMatch({ raw: '12345' })).toBeNull();
  });

  it('finds pairs and aggregates phone and email evidence', () => {
    const result = analyzeExactDuplicates(
      snapshot([
        contact('ada', ['(212) 555-0100'], ['ADA@example.com']),
        contact('grace', ['212-555-0100'], ['ada@example.com']),
        contact('linus', ['+1 212 555 0100'], ['linus@example.com']),
      ]),
    );

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].contactIds).toEqual(['ada', 'grace']);
    expect(result.matches[0].signals.map(({ kind }) => kind)).toEqual(['phone', 'email']);
    expect(result.phoneMatchCount).toBe(1);
    expect(result.emailMatchCount).toBe(1);
    expect(result.affectedContactIds).toEqual(['ada', 'grace']);
  });

  it('does not create a self-match for repeated values on one contact', () => {
    const result = analyzeExactDuplicates(
      snapshot([contact('ada', ['212-555-0100', '212 555 0100'])]),
    );

    expect(result.matches).toEqual([]);
  });

  it('creates every pair when three contacts share the same value', () => {
    const result = analyzeExactDuplicates(
      snapshot([
        contact('a', [], ['team@example.com']),
        contact('b', [], ['team@example.com']),
        contact('c', [], ['team@example.com']),
      ]),
    );

    expect(result.matches.map(({ contactIds }) => contactIds)).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
    ]);
  });

  it('bounds pair expansion for very widely shared contact values', () => {
    const result = analyzeExactDuplicates(
      snapshot(
        Array.from({ length: 100 }, (_, index) =>
          contact(`shared-${index}`, [], ['shared@example.com']),
        ),
      ),
      25,
    );

    expect(result.matches).toHaveLength(25);
    expect(result.isTruncated).toBe(true);
    expect(result.matchLimit).toBe(25);
  });

  it('limits incremental results to pairs touching changed contacts', () => {
    const result = analyzeExactDuplicates(
      snapshot([
        contact('old-a', ['2125550100']),
        contact('old-b', ['2125550100']),
        contact('changed', ['2125550100']),
      ]),
      undefined,
      new Set(['changed']),
    );
    expect(result.matches.map(({ contactIds }) => contactIds)).toEqual([
      ['changed', 'old-a'],
      ['changed', 'old-b'],
    ]);
  });
});
