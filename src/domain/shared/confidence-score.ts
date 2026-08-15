import { assertDomain } from './invariant';

declare const confidenceScoreBrand: unique symbol;

export type ConfidenceScore = number & { readonly [confidenceScoreBrand]: true };

export function createConfidenceScore(value: number): ConfidenceScore {
  assertDomain(
    Number.isFinite(value) && value >= 0 && value <= 1,
    'Confidence score must be a finite number between 0 and 1.',
  );
  return value as ConfidenceScore;
}
