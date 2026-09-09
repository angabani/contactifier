import type {
  SmartMatchingPreferenceRepository,
  SmartMatchingState,
  SmartModelArtifact,
  SmartModelCatalog,
  SmartModelArtifactStore,
} from '../ports/smart-matching';

export class ManageSmartMatching {
  constructor(
    private readonly preferences: SmartMatchingPreferenceRepository,
    private readonly artifacts: SmartModelArtifactStore,
    private readonly catalog: SmartModelCatalog,
  ) {}

  private async availableArtifact(): Promise<SmartModelArtifact | undefined> {
    try {
      return await this.catalog.resolve();
    } catch {
      return undefined;
    }
  }

  async load(): Promise<SmartMatchingState> {
    const consent = await this.preferences.load();
    const availableArtifact = await this.availableArtifact();
    const activeVersion = await this.artifacts.activeVersion();
    if (consent === 'enabled' && activeVersion && (!availableArtifact || activeVersion === availableArtifact.version)) {
      return { consent, status: 'ready', activeVersion, downloadSizeInBytes: availableArtifact?.sizeInBytes };
    }
    if (consent === 'enabled' && availableArtifact) return this.install(availableArtifact);
    return {
      consent,
      status: availableArtifact ? 'available' : 'unavailable',
      activeVersion: activeVersion ?? undefined,
      downloadSizeInBytes: availableArtifact?.sizeInBytes,
    };
  }

  async enable(onState?: (state: SmartMatchingState) => void): Promise<SmartMatchingState> {
    await this.preferences.save('enabled');
    const availableArtifact = await this.availableArtifact();
    if (!availableArtifact) {
      const activeVersion = await this.artifacts.activeVersion();
      if (activeVersion) return { consent: 'enabled', status: 'ready', activeVersion };
      return { consent: 'enabled', status: 'unavailable' };
    }
    const currentVersion = await this.artifacts.activeVersion();
    if (currentVersion === availableArtifact.version) {
      return { consent: 'enabled', status: 'ready', activeVersion: currentVersion, downloadSizeInBytes: availableArtifact.sizeInBytes };
    }

    return this.install(availableArtifact, onState);
  }

  private async install(
    availableArtifact: SmartModelArtifact,
    onState?: (state: SmartMatchingState) => void,
  ): Promise<SmartMatchingState> {
    try {
      onState?.({ consent: 'enabled', status: 'downloading', progress: 0 });
      await this.artifacts.install(availableArtifact, (update) => {
        onState?.({
          consent: 'enabled',
          status: update.phase,
          progress: update.progress,
          downloadSizeInBytes: availableArtifact.sizeInBytes,
        });
      });
      const ready: SmartMatchingState = {
        consent: 'enabled',
        status: 'ready',
        activeVersion: availableArtifact.version,
        progress: 1,
        downloadSizeInBytes: availableArtifact.sizeInBytes,
      };
      onState?.(ready);
      return ready;
    } catch {
      const activeVersion = await this.artifacts.activeVersion();
      if (activeVersion) {
        const ready: SmartMatchingState = { consent: 'enabled', status: 'ready', activeVersion };
        onState?.(ready);
        return ready;
      }
      const failed: SmartMatchingState = { consent: 'enabled', status: 'failed' };
      onState?.(failed);
      return failed;
    }
  }

  async disable(): Promise<SmartMatchingState> {
    const availableArtifact = await this.availableArtifact();
    await this.preferences.save('disabled');
    await this.artifacts.remove();
    return {
      consent: 'disabled',
      status: availableArtifact ? 'available' : 'unavailable',
      downloadSizeInBytes: availableArtifact?.sizeInBytes,
    };
  }
}
