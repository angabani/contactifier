import type { BackupManifest, ContactSnapshot } from '@/domain';

import type {
  BackupProgress,
  VerifiedBackupStore,
} from '../ports/verified-backup-store';

export interface CreateContactBackupRequest {
  readonly snapshot: ContactSnapshot;
  readonly onProgress?: (progress: BackupProgress) => void;
}

export class CreateContactBackup {
  constructor(
    private readonly backupStore: VerifiedBackupStore,
    private readonly chunkContactLimit = 100,
  ) {}

  execute(request: CreateContactBackupRequest): Promise<BackupManifest> {
    return this.backupStore.createVerifiedBackup(request.snapshot, {
      chunkContactLimit: this.chunkContactLimit,
      onProgress: request.onProgress,
    });
  }
}
