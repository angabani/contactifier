/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createBeautificationChangeSet } from '@/application';
import {
  analyzeContactMatches,
  analyzeContactQuality,
  analyzeExactDuplicates,
  createContactProbabilityModel,
  type CanonicalContact,
  type ContactSnapshot,
} from '@/domain';

function contact(id: string, givenName: string, familyName: string, email: string): CanonicalContact {
  return {
    id,
    recordRef: { source: { kind: 'device' }, sourceContactId: id },
    displayName: `${givenName} ${familyName}`,
    name: { givenName, familyName },
    nicknames: [],
    phoneNumbers: [],
    emailAddresses: [{ id: `${id}:email`, value: email, origin: 'source' }],
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

describe('trained model product path', () => {
  it('turns an ambiguous typo match into an explainable ML review item', async () => {
    const createdAt = '2026-09-05T00:00:00.000Z';
    const snapshot: ContactSnapshot = {
      id: 'model-product-path',
      schemaVersion: 1,
      source: { kind: 'device' },
      createdAt,
      contacts: [
        contact('ada-1', 'Ada', 'Lovelace', 'ada.lovelace@example.test'),
        contact('ada-2', 'Ada', 'Lovalace', 'ada.lovalace@example.test'),
      ],
    };
    const bytes = new Uint8Array(readFileSync(join(
      process.cwd(),
      'modeling',
      'fixtures',
      'bootstrap-lightgbm-v1.model',
    )));
    const model = createContactProbabilityModel('contactifier-tree-ensemble-v1', bytes);

    const deterministic = await analyzeContactMatches(snapshot);
    const modelAssisted = await analyzeContactMatches(snapshot, { model });
    const deterministicChanges = createBeautificationChangeSet({
      snapshot,
      duplicateAnalysis: analyzeExactDuplicates(snapshot),
      matchAnalysis: deterministic,
      qualityAnalysis: analyzeContactQuality(snapshot),
      createdAt,
    });
    const modelChanges = createBeautificationChangeSet({
      snapshot,
      duplicateAnalysis: analyzeExactDuplicates(snapshot),
      matchAnalysis: modelAssisted,
      qualityAnalysis: analyzeContactQuality(snapshot),
      createdAt,
    });

    expect(deterministicChanges.changes).toHaveLength(0);
    expect(modelAssisted).toMatchObject({ scoringMode: 'model', comparedPairCount: 1 });
    expect(modelChanges.changes).toHaveLength(1);
    expect(modelChanges.changes[0]).toMatchObject({
      kind: 'merge',
      origin: 'ml',
      decision: 'pending',
      contactIds: ['ada-1', 'ada-2'],
    });
    expect(modelChanges.changes[0].reasons).toContain('Similar name');
  });
});
