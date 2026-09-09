import {
  analyzeContactMatches,
  createContactMatchMatrix,
  deterministicContactMatchProbability,
  type CanonicalContact,
  type ContactSnapshot,
} from '@/domain';

function contact(id: string, name: string, phone?: string, email?: string, organization?: string): CanonicalContact {
  return {
    id,
    recordRef: { source: { kind: 'device' }, sourceContactId: id },
    displayName: name,
    name: { givenName: name.split(' ')[0], familyName: name.split(' ')[1] },
    nicknames: [],
    phoneNumbers: phone ? [{ id: `${id}:p`, value: { raw: phone }, origin: 'source' }] : [],
    emailAddresses: email ? [{ id: `${id}:e`, value: email, origin: 'source' }] : [],
    postalAddresses: [],
    organizations: organization ? [{ id: `${id}:o`, value: { name: organization }, origin: 'source' }] : [],
    urls: [], birthdays: [], events: [], notes: [], groups: [], photos: [], extensions: {},
  };
}

function snapshot(contacts: readonly CanonicalContact[]): ContactSnapshot {
  return { id: 's', schemaVersion: 1, source: { kind: 'device' }, createdAt: '2026-09-04T00:00:00.000Z', contacts };
}

describe('contact match matrix', () => {
  it('keeps missing fields distinct from disagreement', () => {
    const matrix = createContactMatchMatrix(
      contact('a', 'Aarav Khanna', '2125550100'),
      contact('b', 'Arav Khanna', '2125550100'),
    );
    expect(matrix.features.find(({ kind }) => kind === 'phone')?.score).toBe(1);
    expect(matrix.features.find(({ kind }) => kind === 'email')?.score).toBeNull();
    expect(matrix.features.find(({ kind }) => kind === 'name')?.score).toBeGreaterThan(0.8);
    expect(deterministicContactMatchProbability(matrix)).toBeGreaterThan(0.8);
  });

  it('captures structured, phonetic, email-component, and phone compatibility evidence', () => {
    const left = {
      ...contact('a', 'Riley Chen', '+1 415 555 0101', 'riley.chen@studio.example'),
      name: { givenName: 'Riley', familyName: 'Chen', phoneticGivenName: 'Rye-lee' },
      phoneNumbers: [{ id: 'a:p', value: { raw: '+1 415 555 0101', countryCode: '+1' }, origin: 'source' as const }],
    };
    const right = {
      ...contact('b', 'Chen Riley', '415-555-0101', 'riley.chen@studio.example'),
      name: { givenName: 'Chen', familyName: 'Riley', phoneticGivenName: 'Rye-lee' },
      phoneNumbers: [{ id: 'b:p', value: { raw: '415-555-0101', countryCode: '1' }, origin: 'source' as const }],
    };
    const features = new Map(createContactMatchMatrix(left, right).features.map((feature) => [feature.kind, feature.score]));
    expect(features.get('phoneSuffix')).toBe(1);
    expect(features.get('phoneCountry')).toBe(1);
    expect(features.get('emailLocalPart')).toBe(1);
    expect(features.get('emailDomain')).toBe(1);
    expect(features.get('nameOrder')).toBe(1);
    expect(features.get('phoneticName')).toBe(1);
  });

  it('does not treat unknown phone countries as disagreement', () => {
    const matrix = createContactMatchMatrix(
      contact('a', 'A Person', '4155550101'),
      contact('b', 'A Person', '415-555-0101'),
    );
    expect(matrix.features.find(({ kind }) => kind === 'phoneCountry')?.score).toBeNull();
  });

  it('generates bounded candidates and excludes unrelated contacts', async () => {
    const result = await analyzeContactMatches(snapshot([
      contact('a', 'Aarav Khanna', '2125550100'),
      contact('b', 'Arav Khanna', '2125550100'),
      contact('c', 'Linus Torvalds', '4155550200'),
    ]));
    expect(result.comparedPairCount).toBe(1);
    expect(result.candidates[0].contactIds).toEqual(['a', 'b']);
  });

  it('uses an optional model only for generated candidates', async () => {
    const score = jest.fn(async () => 0.73);
    const result = await analyzeContactMatches(
      snapshot([contact('a', 'Ada Lovelace'), contact('b', 'Ada Lovalace')]),
      { model: { version: 'test', score } },
    );
    expect(score).toHaveBeenCalledTimes(1);
    expect(result.candidates[0]).toMatchObject({ probability: 0.73, band: 'careful-review', scoringMode: 'model' });
  });

  it('enforces the global pair limit', async () => {
    const result = await analyzeContactMatches(
      snapshot(Array.from({ length: 12 }, (_, index) => contact(String(index), 'Shared Person', '2125550100'))),
      { pairLimit: 5 },
    );
    expect(result.comparedPairCount).toBe(5);
    expect(result.isTruncated).toBe(true);
  });

  it('compares only pairs touching an incrementally changed contact', async () => {
    const result = await analyzeContactMatches(
      snapshot([
        contact('old-a', 'Shared Person', '2125550100'),
        contact('old-b', 'Shared Person', '2125550100'),
        contact('changed', 'Shared Person', '2125550100'),
      ]),
      { focusContactIds: new Set(['changed']) },
    );
    expect(result.candidates.map(({ contactIds }) => contactIds)).toEqual([
      ['changed', 'old-a'],
      ['changed', 'old-b'],
    ]);
  });
});
