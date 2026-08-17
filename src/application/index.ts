export type { Clock } from './ports/clock';
export type { ContactReader, ContactReadResult } from './ports/contact-reader';
export type { IdGenerator } from './ports/id-generator';
export type {
  BackupProgress,
  BackupProgressPhase,
  CreateBackupOptions,
  VerifiedBackupStore,
} from './ports/verified-backup-store';
export {
  CreateContactBackup,
  type CreateContactBackupRequest,
} from './use-cases/create-contact-backup';
export { LoadContactBackup } from './use-cases/load-contact-backup';
export { ListContactBackups } from './use-cases/list-contact-backups';
export { PreviewContactRestore } from './use-cases/preview-contact-restore';
export {
  createExactDuplicateChangeSet,
  type CreateExactDuplicateChangeSetInput,
} from './use-cases/create-exact-duplicate-change-set';
export {
  createBeautificationChangeSet,
  type CreateBeautificationChangeSetInput,
} from './use-cases/create-beautification-change-set';
export {
  setChangeDecision,
  summarizeChangeDecisions,
  type ChangeDecisionSummary,
  type ReviewDecision,
} from './use-cases/review-change-set';
export {
  ReadContactSource,
  type ReadContactSourceDependencies,
  type ReadContactSourceRequest,
} from './use-cases/read-contact-source';
