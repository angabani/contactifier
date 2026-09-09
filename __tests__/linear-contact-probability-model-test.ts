import { createContactMatchMatrix, createLinearContactProbabilityModel, type CanonicalContact } from '@/domain';

function contact(id: string, name: string): CanonicalContact {
  return {
    id,
    recordRef: { source: { kind: 'device' }, sourceContactId: id },
    displayName: name,
    nicknames: [], phoneNumbers: [], emailAddresses: [], postalAddresses: [], organizations: [],
    urls: [], birthdays: [], events: [], notes: [], groups: [], photos: [], extensions: {},
  };
}

describe('linear contact probability model', () => {
  it('loads a versioned data-only model and scores the match matrix', async () => {
    const model = createLinearContactProbabilityModel(new TextEncoder().encode(JSON.stringify({
      schemaVersion: 1,
      version: 'model-1',
      bias: -2,
      weights: { name: 5 },
      missingWeights: { phone: -0.2 },
    })));
    const probability = await model.score(createContactMatchMatrix(
      contact('a', 'Ada Lovelace'),
      contact('b', 'Ada Lovelace'),
    ));
    expect(model.version).toBe('model-1');
    expect(probability).toBeGreaterThan(0.9);
  });

  it('rejects malformed and oversized model data', () => {
    expect(() => createLinearContactProbabilityModel(new TextEncoder().encode('{}'))).toThrow();
    expect(() => createLinearContactProbabilityModel(new Uint8Array(1024 * 1024 + 1))).toThrow();
  });
});
