import {
  ManageSmartMatching,
  type SmartMatchingConsent,
  type SmartMatchingPreferenceRepository,
  type SmartModelCatalog,
  type SmartModelArtifactStore,
} from '@/application';

class Preferences implements SmartMatchingPreferenceRepository {
  value: SmartMatchingConsent = 'undecided';
  async load() { return this.value; }
  async save(value: SmartMatchingConsent) { this.value = value; }
}

class Artifacts implements SmartModelArtifactStore {
  version: string | null = null;
  shouldFail = false;
  async activeVersion() { return this.version; }
  async activeArtifact() { return this.version ? { version: this.version, format: 'contactifier-linear-v1' as const } : null; }
  async loadActiveBytes() { return null; }
  async install(artifact: { readonly version: string }, onProgress?: (update: { readonly phase: 'downloading' | 'verifying'; readonly progress?: number }) => void) {
    onProgress?.({ phase: 'downloading', progress: 0.5 });
    onProgress?.({ phase: 'verifying' });
    if (this.shouldFail) throw new Error('offline');
    this.version = artifact.version;
  }
  async remove() { this.version = null; }
}

const artifact = { version: '1', format: 'contactifier-linear-v1' as const, url: 'https://example.test/model', sha256: 'a'.repeat(64) };
const catalog = (value = artifact): SmartModelCatalog => ({ async resolve() { return value; } });
const emptyCatalog: SmartModelCatalog = { async resolve() { return undefined; } };

describe('ManageSmartMatching', () => {
  it('stays fully available without a configured model', async () => {
    const manager = new ManageSmartMatching(new Preferences(), new Artifacts(), emptyCatalog);
    await expect(manager.load()).resolves.toEqual({ consent: 'undecided', status: 'unavailable', activeVersion: undefined });
    await expect(manager.enable()).resolves.toEqual({ consent: 'enabled', status: 'unavailable' });
  });

  it('downloads and activates the configured version after consent', async () => {
    const preferences = new Preferences();
    const artifacts = new Artifacts();
    const manager = new ManageSmartMatching(preferences, artifacts, catalog());
    const states: string[] = [];
    await expect(manager.enable((state) => states.push(state.status))).resolves.toMatchObject({ status: 'ready', activeVersion: '1' });
    expect(preferences.value).toBe('enabled');
    expect(states).toEqual(['downloading', 'downloading', 'verifying', 'ready']);
  });

  it('automatically replaces an older model after prior consent', async () => {
    const preferences = new Preferences();
    preferences.value = 'enabled';
    const artifacts = new Artifacts();
    artifacts.version = 'old';
    const manager = new ManageSmartMatching(preferences, artifacts, catalog());
    await expect(manager.load()).resolves.toMatchObject({ status: 'ready', activeVersion: '1' });
    expect(artifacts.version).toBe('1');
  });

  it('falls back safely when the download fails and can be disabled', async () => {
    const preferences = new Preferences();
    const artifacts = new Artifacts();
    artifacts.shouldFail = true;
    const manager = new ManageSmartMatching(preferences, artifacts, catalog());
    await expect(manager.enable()).resolves.toEqual({ consent: 'enabled', status: 'failed' });
    await expect(manager.disable()).resolves.toEqual({ consent: 'disabled', status: 'available' });
    expect(preferences.value).toBe('disabled');
  });
});
