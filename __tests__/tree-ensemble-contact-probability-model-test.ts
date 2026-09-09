import { createContactMatchMatrix, createContactProbabilityModel, type CanonicalContact } from '@/domain';

function contact(id: string, name: string): CanonicalContact {
  return {
    id, recordRef: { source: { kind: 'device' }, sourceContactId: id }, displayName: name,
    nicknames: [], phoneNumbers: [], emailAddresses: [], postalAddresses: [], organizations: [],
    urls: [], birthdays: [], events: [], notes: [], groups: [], photos: [], extensions: {},
  };
}

describe('tree ensemble contact probability model', () => {
  it('loads through the format registry and follows feature branches', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({
      schemaVersion: 1, version: 'tree-1', baseScore: -1, learningRate: 1,
      trees: [[
        { feature: 'name', threshold: 0.8, left: 1, right: 2, missing: 1 },
        { value: -2 }, { value: 4 },
      ]],
    }));
    const model = createContactProbabilityModel('contactifier-tree-ensemble-v1', bytes);
    const probability = await model.score(createContactMatchMatrix(contact('a', 'Ada Lovelace'), contact('b', 'Ada Lovelace')));
    expect(model.version).toBe('tree-1');
    expect(probability).toBeGreaterThan(0.9);
  });

  it('rejects cycles', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({
      schemaVersion: 1, version: 'bad', baseScore: 0, learningRate: 1,
      trees: [[{ feature: 'name', threshold: 0.5, left: 0, right: 0, missing: 0 }]],
    }));
    expect(() => createContactProbabilityModel('contactifier-tree-ensemble-v1', bytes)).toThrow();
  });
});
