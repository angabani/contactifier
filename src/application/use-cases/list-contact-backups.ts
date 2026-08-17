import type { BackupManifest } from '@/domain';

import type { VerifiedBackupStore } from '../ports/verified-backup-store';

export class ListContactBackups {
  constructor(private readonly backupStore: VerifiedBackupStore) {}

  execute(): Promise<readonly BackupManifest[]> {
    return this.backupStore.listVerifiedBackups();
  }
}
