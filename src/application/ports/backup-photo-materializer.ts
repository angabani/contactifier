import type { BackupManifest } from '@/domain';

export interface MaterializedBackupPhoto {
  readonly assetId: string;
  readonly uri: string;
  readonly plaintextSha256: string;
}

export interface BackupPhotoMaterializationLease {
  readonly photos: readonly MaterializedBackupPhoto[];
  release(): Promise<void>;
}

export interface BackupPhotoMaterializer {
  materialize(
    manifest: BackupManifest,
    assetIds: readonly string[],
  ): Promise<BackupPhotoMaterializationLease>;
}
