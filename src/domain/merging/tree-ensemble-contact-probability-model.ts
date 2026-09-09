import type {
  ContactMatchFeatureKind,
  ContactMatchMatrix,
  ContactProbabilityModel,
} from './contact-match-matrix';

type TreeNode =
  | { readonly value: number }
  | {
    readonly feature: ContactMatchFeatureKind;
    readonly threshold: number;
    readonly left: number;
    readonly right: number;
    readonly missing: number;
  };

interface TreeEnsembleArtifact {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly baseScore: number;
  readonly learningRate: number;
  readonly trees: readonly (readonly TreeNode[])[];
  readonly calibration?: { readonly slope: number; readonly intercept: number };
}

const featureKinds = new Set<ContactMatchFeatureKind>([
  'email', 'emailLocalPart', 'emailDomain', 'phone', 'phoneSuffix', 'phoneCountry',
  'name', 'givenName', 'familyName', 'nameOrder', 'phoneticName', 'nickname',
  'organization', 'address', 'sameSource',
]);
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_TREES = 128;
const MAX_TOTAL_NODES = 4096;
const MAX_DEPTH = 16;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateTree(nodes: readonly TreeNode[]): void {
  if (!Array.isArray(nodes) || nodes.length === 0) throw new Error('Smart model tree is empty.');
  const visiting = new Set<number>();
  const visited = new Set<number>();
  const visit = (index: number, depth: number): void => {
    if (!Number.isInteger(index) || index < 0 || index >= nodes.length || depth > MAX_DEPTH || visiting.has(index)) {
      throw new Error('Smart model tree structure is invalid.');
    }
    if (visited.has(index)) return;
    visiting.add(index);
    const node = nodes[index] as TreeNode;
    if ('value' in node) {
      if (!finite(node.value)) throw new Error('Smart model leaf is invalid.');
    } else {
      if (typeof node.feature !== 'string' || !featureKinds.has(node.feature as ContactMatchFeatureKind)
        || !finite(node.threshold) || !Number.isInteger(node.left)
        || !Number.isInteger(node.right) || !Number.isInteger(node.missing)) {
        throw new Error('Smart model node is invalid.');
      }
      visit(node.left, depth + 1);
      visit(node.right, depth + 1);
      visit(node.missing, depth + 1);
    }
    visiting.delete(index);
    visited.add(index);
  };
  visit(0, 0);
}

function validateArtifact(value: unknown): TreeEnsembleArtifact {
  if (!value || typeof value !== 'object') throw new Error('Smart model must be an object.');
  const candidate = value as Partial<TreeEnsembleArtifact>;
  if (candidate.schemaVersion !== 1 || typeof candidate.version !== 'string' || !candidate.version
    || !finite(candidate.baseScore) || !finite(candidate.learningRate)
    || !Array.isArray(candidate.trees) || candidate.trees.length === 0 || candidate.trees.length > MAX_TREES) {
    throw new Error('Smart model metadata is invalid.');
  }
  const totalNodes = candidate.trees.reduce((sum, tree) => sum + (Array.isArray(tree) ? tree.length : MAX_TOTAL_NODES + 1), 0);
  if (totalNodes > MAX_TOTAL_NODES) throw new Error('Smart model has too many nodes.');
  candidate.trees.forEach(validateTree);
  if (candidate.calibration && (!finite(candidate.calibration.slope) || !finite(candidate.calibration.intercept))) {
    throw new Error('Smart model calibration is invalid.');
  }
  return candidate as TreeEnsembleArtifact;
}

export function createTreeEnsembleContactProbabilityModel(bytes: Uint8Array): ContactProbabilityModel {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) throw new Error('Smart model payload has an invalid size.');
  const artifact = validateArtifact(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
  return Object.freeze({
    version: artifact.version,
    async score(matrix: ContactMatchMatrix): Promise<number> {
      const features = new Map(matrix.features.map((feature) => [feature.kind, feature.score]));
      let rawScore = artifact.baseScore;
      for (const nodes of artifact.trees) {
        let index = 0;
        while (true) {
          const node = nodes[index];
          if ('value' in node) {
            rawScore += artifact.learningRate * node.value;
            break;
          }
          const value = features.get(node.feature);
          index = value === null || value === undefined
            ? node.missing
            : value <= node.threshold ? node.left : node.right;
        }
      }
      const calibrated = artifact.calibration
        ? artifact.calibration.slope * rawScore + artifact.calibration.intercept
        : rawScore;
      return 1 / (1 + Math.exp(-calibrated));
    },
  });
}
