import type { BackupManifest, ContactRestorePlan } from '@/domain';
import { createContactRestorePlan } from '@/domain';

import { LoadContactBackup } from './load-contact-backup';
import { ReadContactSource } from './read-contact-source';

export class PreviewContactRestore {
  constructor(
    private readonly loadBackup: LoadContactBackup,
    private readonly readContactSource: ReadContactSource,
  ) {}

  async execute(manifest: BackupManifest): Promise<ContactRestorePlan> {
    const [backup, current] = await Promise.all([
      this.loadBackup.execute(manifest),
      this.readContactSource.execute({ source: manifest.source }),
    ]);
    return createContactRestorePlan(backup, current);
  }
}
