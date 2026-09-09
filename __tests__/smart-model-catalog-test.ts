import { HttpSmartModelCatalog, validateSmartModelArtifact } from '@/infrastructure/smart-matching/http-smart-model-catalog';

const artifact = {
  version: 'contacts-2026-09', format: 'contactifier-tree-ensemble-v1',
  url: 'https://models.example.test/contacts.model', sha256: 'a'.repeat(64), sizeInBytes: 1234,
};

describe('smart model catalog', () => {
  afterEach(() => jest.restoreAllMocks());

  it('resolves the active model dynamically from a remote manifest', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, text: async () => JSON.stringify({ active: artifact }) } as Response);
    await expect(new HttpSmartModelCatalog('https://models.example.test/manifest.json').resolve()).resolves.toEqual(artifact);
  });

  it('allows model delivery to be disabled without an app release', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, text: async () => '{}' } as Response);
    await expect(new HttpSmartModelCatalog('https://models.example.test/manifest.json').resolve()).resolves.toBeUndefined();
  });

  it('rejects insecure, unknown, and malformed artifacts', () => {
    expect(() => validateSmartModelArtifact({ ...artifact, url: 'http://example.test/model' })).toThrow();
    expect(() => validateSmartModelArtifact({ ...artifact, format: 'onnx-anything' })).toThrow();
    expect(() => validateSmartModelArtifact({ ...artifact, sha256: 'short' })).toThrow();
  });
});
