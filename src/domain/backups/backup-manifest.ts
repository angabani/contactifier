import type { ContactSourceRef } from '../contacts/contact-source';
import type { ContactAccessScope, ContactSnapshotId } from '../contacts/contact-snapshot';

export type BackupId = string;

export interface BackupArtifact {
  /** Directory containing the manifest and encrypted chunk files. */
  readonly uri: string;
  readonly sizeInBytes: number;
  /** SHA-256 over the ordered chunk metadata and hashes. */
  readonly sha256: string;
}

export interface BackupChunk {
  readonly index: number;
  readonly fileName: string;
  readonly contactCount: number;
  readonly encryptedSizeInBytes: number;
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
  readonly snapshotCreatedAt: string;
  readonly snapshotSourceRevision?: string;
  readonly snapshotContentHash?: string;
  readonly snapshotAccessScope?: ContactAccessScope;
  readonly source: ContactSourceRef;
  /** Time at which the backup was created. */
  readonly createdAt: string;
  readonly contactCount: number;
  readonly chunkContactLimit: number;
  readonly chunks: readonly BackupChunk[];
  readonly artifact: BackupArtifact;
  readonly encryption: BackupEncryption;
}
