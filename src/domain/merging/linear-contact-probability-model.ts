import type {
  ContactMatchFeatureKind,
  ContactMatchMatrix,
  ContactProbabilityModel,
} from './contact-match-matrix';

interface LinearContactModelArtifact {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly bias: number;
  readonly weights: Readonly<Partial<Record<ContactMatchFeatureKind, number>>>;
  readonly missingWeights?: Readonly<Partial<Record<ContactMatchFeatureKind, number>>>;
  readonly calibration?: { readonly slope: number; readonly intercept: number };
}

const featureKinds: readonly ContactMatchFeatureKind[] = [
  'email', 'emailLocalPart', 'emailDomain', 'phone', 'phoneSuffix', 'phoneCountry',
  'name', 'givenName', 'familyName', 'nameOrder', 'phoneticName', 'nickname',
  'organization', 'address', 'sameSource',
];

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateArtifact(value: unknown): LinearContactModelArtifact {
  if (!value || typeof value !== 'object') throw new Error('Smart model must be an object.');
  const candidate = value as Partial<LinearContactModelArtifact>;
  if (candidate.schemaVersion !== 1 || typeof candidate.version !== 'string' || !candidate.version || !finite(candidate.bias)) {
    throw new Error('Smart model metadata is invalid.');
  }
  if (!candidate.weights || typeof candidate.weights !== 'object') throw new Error('Smart model weights are missing.');
  for (const kind of featureKinds) {
    const weight = candidate.weights[kind];
    const missingWeight = candidate.missingWeights?.[kind];
    if (weight !== undefined && !finite(weight)) throw new Error(`Smart model ${kind} weight is invalid.`);
    if (missingWeight !== undefined && !finite(missingWeight)) throw new Error(`Smart model ${kind} missing weight is invalid.`);
  }
  if (candidate.calibration && (!finite(candidate.calibration.slope) || !finite(candidate.calibration.intercept))) {
    throw new Error('Smart model calibration is invalid.');
  }
  return candidate as LinearContactModelArtifact;
}

export function createLinearContactProbabilityModel(bytes: Uint8Array): ContactProbabilityModel {
  if (bytes.byteLength === 0 || bytes.byteLength > 1024 * 1024) {
    throw new Error('Smart model payload has an invalid size.');
  }
  const artifact = validateArtifact(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
  return Object.freeze({
    version: artifact.version,
    async score(matrix: ContactMatchMatrix): Promise<number> {
      let logit = artifact.bias;
      for (const feature of matrix.features) {
        logit += feature.score === null
          ? (artifact.missingWeights?.[feature.kind] ?? 0)
          : feature.score * (artifact.weights[feature.kind] ?? 0);
      }
      const calibrated = artifact.calibration
        ? artifact.calibration.slope * logit + artifact.calibration.intercept
        : logit;
      return 1 / (1 + Math.exp(-calibrated));
    },
  });
}
