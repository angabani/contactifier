import type { SmartModelArtifact, SmartModelCatalog, SmartModelFormat } from '@/application';

const MAX_MANIFEST_BYTES = 32 * 1024;
const formats = new Set<SmartModelFormat>([
  'contactifier-linear-v1',
  'contactifier-tree-ensemble-v1',
]);

export function validateSmartModelArtifact(value: unknown): SmartModelArtifact {
  if (!value || typeof value !== 'object') throw new Error('Smart model manifest is invalid.');
  const candidate = value as Partial<SmartModelArtifact>;
  if (typeof candidate.version !== 'string' || !candidate.version || candidate.version.length > 100
    || typeof candidate.format !== 'string' || !formats.has(candidate.format as SmartModelFormat)
    || typeof candidate.url !== 'string' || !candidate.url.startsWith('https://')
    || typeof candidate.sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(candidate.sha256)
    || (candidate.sizeInBytes !== undefined
      && (!Number.isSafeInteger(candidate.sizeInBytes) || candidate.sizeInBytes <= 0))) {
    throw new Error('Smart model manifest fields are invalid.');
  }
  return Object.freeze({
    version: candidate.version,
    format: candidate.format as SmartModelFormat,
    url: candidate.url,
    sha256: candidate.sha256.toLowerCase(),
    sizeInBytes: candidate.sizeInBytes,
  });
}

export class StaticSmartModelCatalog implements SmartModelCatalog {
  constructor(private readonly artifact?: SmartModelArtifact) {}
  async resolve(): Promise<SmartModelArtifact | undefined> { return this.artifact; }
}

export class HttpSmartModelCatalog implements SmartModelCatalog {
  constructor(private readonly manifestUrl: string) {
    if (!manifestUrl.startsWith('https://')) throw new Error('Smart model manifest URL must use HTTPS.');
  }

  async resolve(): Promise<SmartModelArtifact | undefined> {
    const response = await fetch(this.manifestUrl, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Smart model manifest request failed (${response.status}).`);
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_MANIFEST_BYTES) {
      throw new Error('Smart model manifest exceeds the safe size limit.');
    }
    const payload = JSON.parse(text) as { readonly active?: unknown };
    return payload.active === undefined ? undefined : validateSmartModelArtifact(payload.active);
  }
}
