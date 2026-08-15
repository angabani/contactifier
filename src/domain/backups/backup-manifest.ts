import type { ContactSourceRef } from '../contacts/contact-source';
import type { ContactSnapshotId } from '../contacts/contact-snapshot';

export type BackupId = string;

export interface BackupArtifact {
  readonly uri: string;
  readonly sizeInBytes: number;
  readonly sha256: string;
}

export interface BackupEncryption {
  readonly algorithm: 'AES-256-GCM';
  readonly keyAlias: string;
}

export interface BackupManifest {
  readonly id: BackupId;
  readonly schemaVersion: 1;
  readonly snapshotId: ContactSnapshotId;
  readonly source: ContactSourceRef;
  readonly createdAt: string;
  readonly contactCount: number;
  readonly artifact: BackupArtifact;
  readonly encryption: BackupEncryption;
}
