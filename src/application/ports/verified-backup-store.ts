import type { BackupManifest, CanonicalContact, ContactSnapshot } from '@/domain';

export type BackupProgressPhase = 'encrypting' | 'verifying';

export interface BackupProgress {
  readonly phase: BackupProgressPhase;
  readonly completedContacts: number;
  readonly totalContacts: number;
}

export interface CreateBackupOptions {
  readonly chunkContactLimit: number;
  readonly onProgress?: (progress: BackupProgress) => void;
}

export interface VerifiedBackupStore {
  createVerifiedBackup(
    snapshot: ContactSnapshot,
    options: CreateBackupOptions,
  ): Promise<BackupManifest>;
  readVerifiedBackup(
    manifest: BackupManifest,
  ): AsyncIterable<readonly CanonicalContact[]>;
  listVerifiedBackups(): Promise<readonly BackupManifest[]>;
}
