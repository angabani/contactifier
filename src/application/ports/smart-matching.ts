export type SmartMatchingConsent = 'undecided' | 'enabled' | 'disabled';

export type SmartModelFormat = 'contactifier-linear-v1' | 'contactifier-tree-ensemble-v1';

export interface SmartModelArtifact {
  readonly version: string;
  readonly format: SmartModelFormat;
  readonly url: string;
  readonly sha256: string;
  readonly sizeInBytes?: number;
}

export interface SmartModelCatalog {
  resolve(): Promise<SmartModelArtifact | undefined>;
}

export type SmartModelStatus =
  | 'unavailable'
  | 'available'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'failed';

export interface SmartMatchingState {
  readonly consent: SmartMatchingConsent;
  readonly status: SmartModelStatus;
  readonly activeVersion?: string;
  readonly downloadSizeInBytes?: number;
  readonly progress?: number;
}

export interface SmartMatchingPreferenceRepository {
  load(): Promise<SmartMatchingConsent>;
  save(value: SmartMatchingConsent): Promise<void>;
}

export interface SmartModelArtifactStore {
  activeArtifact(): Promise<Pick<SmartModelArtifact, 'version' | 'format'> | null>;
  activeVersion(): Promise<string | null>;
  loadActiveBytes(): Promise<Uint8Array | null>;
  install(
    artifact: SmartModelArtifact,
    onProgress?: (update: {
      readonly phase: 'downloading' | 'verifying';
      readonly progress?: number;
    }) => void,
  ): Promise<void>;
  remove(): Promise<void>;
}
