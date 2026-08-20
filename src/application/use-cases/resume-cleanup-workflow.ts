import {
  createContactSnapshot,
  isSameContactSource,
  type BackupManifest,
  type CanonicalContact,
  type CleanupWorkflow,
  type ContactSnapshot,
} from '@/domain';

import type { CleanupWorkflowRepository } from '../ports/cleanup-workflow-repository';
import type { VerifiedBackupStore } from '../ports/verified-backup-store';

export class CleanupWorkflowResumeError extends Error {
  constructor(readonly code: 'backup-unavailable' | 'workflow-unavailable') {
    super(code === 'workflow-unavailable' ? 'Saved cleanup workflow is unavailable.' : 'Matching verified backup is unavailable.');
    this.name = 'CleanupWorkflowResumeError';
  }
}

export interface ResumedCleanupWorkflow {
  readonly workflow: CleanupWorkflow;
  readonly backup: BackupManifest;
  readonly snapshot: ContactSnapshot;
}

export class ResumeCleanupWorkflow {
  constructor(
    private readonly workflowRepository: CleanupWorkflowRepository,
    private readonly backupStore: VerifiedBackupStore,
  ) {}

  async execute(workflowId: string): Promise<ResumedCleanupWorkflow> {
    const workflow = await this.workflowRepository.load(workflowId);
    if (!workflow) throw new CleanupWorkflowResumeError('workflow-unavailable');
    const backup = (await this.backupStore.listVerifiedBackups()).find(
      (candidate) =>
        candidate.id === workflow.backupId &&
        candidate.snapshotId === workflow.snapshotId &&
        isSameContactSource(candidate.source, workflow.source),
    );
    if (!backup) throw new CleanupWorkflowResumeError('backup-unavailable');

    const contacts: CanonicalContact[] = [];
    for await (const chunk of this.backupStore.readVerifiedBackup(backup)) contacts.push(...chunk);
    const snapshot = createContactSnapshot({
      id: backup.snapshotId,
      schemaVersion: 1,
      source: backup.source,
      createdAt: backup.snapshotCreatedAt,
      sourceRevision: backup.snapshotSourceRevision,
      contentHash: backup.snapshotContentHash,
      accessScope: backup.snapshotAccessScope,
      contacts,
    });
    return Object.freeze({ workflow, backup, snapshot });
  }
}
