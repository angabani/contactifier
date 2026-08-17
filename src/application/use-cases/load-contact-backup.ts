import {
  createContactSnapshot,
  type BackupManifest,
  type CanonicalContact,
  type ContactSnapshot,
} from '@/domain';

import type { VerifiedBackupStore } from '../ports/verified-backup-store';

export class LoadContactBackup {
  constructor(private readonly backupStore: VerifiedBackupStore) {}

  async execute(manifest: BackupManifest): Promise<ContactSnapshot> {
    const contacts: CanonicalContact[] = [];
    for await (const chunk of this.backupStore.readVerifiedBackup(manifest)) {
      contacts.push(...chunk);
    }

    return createContactSnapshot({
      id: manifest.snapshotId,
      schemaVersion: 1,
      source: manifest.source,
      createdAt: manifest.snapshotCreatedAt,
      sourceRevision: manifest.snapshotSourceRevision,
      contentHash: manifest.snapshotContentHash,
      accessScope: manifest.snapshotAccessScope,
      contacts,
    });
  }
}
