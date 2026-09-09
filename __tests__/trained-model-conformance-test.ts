/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createContactProbabilityModel, type ContactMatchFeatureKind, type ContactMatchMatrix } from '@/domain';

interface GoldenVector {
  readonly features: Readonly<Record<ContactMatchFeatureKind, number | null>>;
  readonly probability: number;
}

describe('exported training model conformance', () => {
  it('matches probabilities emitted by the LightGBM training implementation', async () => {
    const fixtureDirectory = join(process.cwd(), 'modeling', 'fixtures');
    const report = JSON.parse(readFileSync(join(fixtureDirectory, 'evaluation.json'), 'utf8')) as {
      readonly lightgbmExport: { readonly goldenVectors: readonly GoldenVector[] };
    };
    const bytes = new Uint8Array(readFileSync(join(fixtureDirectory, 'bootstrap-lightgbm-v1.model')));
    const model = createContactProbabilityModel('contactifier-tree-ensemble-v1', bytes);
    for (const [index, golden] of report.lightgbmExport.goldenVectors.entries()) {
      const matrix: ContactMatchMatrix = {
        schemaVersion: 1,
        contactIds: [`left-${index}`, `right-${index}`],
        features: Object.entries(golden.features).map(([kind, score]) => ({
          kind: kind as ContactMatchFeatureKind,
          score,
          explanation: kind,
          isConflict: score !== null && score < 0.25,
        })),
      };
      await expect(model.score(matrix)).resolves.toBeCloseTo(golden.probability, 12);
    }
  });
});
