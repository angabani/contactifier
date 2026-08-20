import {
  createDryRunContactWritePlan,
  type BackupManifest,
  type ChangeSet,
  type ContactSnapshot,
  type ContactWritePlan,
} from '@/domain';

import type { Clock } from '../ports/clock';
import { ReadContactSource } from './read-contact-source';

export interface PrepareContactWriteRequest {
  readonly analyzedSnapshot: ContactSnapshot;
  readonly backup: BackupManifest;
  readonly changeSet: ChangeSet;
}

export class PrepareContactWrite {
  constructor(
    private readonly readContactSource: ReadContactSource,
    private readonly clock: Clock,
  ) {}

  async execute(request: PrepareContactWriteRequest): Promise<ContactWritePlan> {
    const freshSnapshot = await this.readContactSource.execute({
      source: request.analyzedSnapshot.source,
    });
    return createDryRunContactWritePlan({
      ...request,
      freshSnapshot,
      plannedAt: this.clock.now().toISOString(),
    });
  }
}
