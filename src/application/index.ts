export type { Clock } from './ports/clock';
export {
  ContactPermissionDeniedError,
  type ContactReader,
  type ContactReadResult,
} from './ports/contact-reader';
export type { IdGenerator } from './ports/id-generator';
export type {
  BackupPhotoMaterializationLease,
  BackupPhotoMaterializer,
  MaterializedBackupPhoto,
} from './ports/backup-photo-materializer';
export {
  ContactWriteNotAppliedError,
  type ContactWriter,
  type ContactWriteVerifier,
  type ContactWriteReconciler,
  type ContactWriteReconciliation,
} from './ports/contact-writer';
export {
  CleanupWorkflowConflictError,
  type CleanupWorkflowRepository,
  type CleanupWorkflowSummary,
} from './ports/cleanup-workflow-repository';
export type {
  BackupProgress,
  BackupProgressPhase,
  CreateBackupOptions,
  VerifiedBackupStore,
} from './ports/verified-backup-store';
export {
  defaultContactConfirmationPreferences,
  type ContactConfirmationPreferenceRepository,
  type ContactConfirmationPreferences,
  type ContactConfirmationType,
} from './ports/contact-confirmation-preference-repository';
export type {
  SmartMatchingConsent,
  SmartMatchingPreferenceRepository,
  SmartMatchingState,
  SmartModelArtifact,
  SmartModelCatalog,
  SmartModelFormat,
  SmartModelArtifactStore,
  SmartModelStatus,
} from './ports/smart-matching';
export { ManageSmartMatching } from './use-cases/manage-smart-matching';
export {
  CreateContactBackup,
  type CreateContactBackupRequest,
} from './use-cases/create-contact-backup';
export { LoadContactBackup } from './use-cases/load-contact-backup';
export { ListContactBackups } from './use-cases/list-contact-backups';
export { PreviewContactRestore } from './use-cases/preview-contact-restore';
export {
  prepareContactBackupRestore,
  type PreparedContactBackupRestore,
} from './use-cases/prepare-contact-backup-restore';
export {
  previewContactTransactionUndo,
  type ContactTransactionUndoBlockReason,
  type ContactTransactionUndoPreview,
} from './use-cases/preview-contact-transaction-undo';
export {
  prepareContactTransactionUndo,
  type PreparedContactTransactionUndo,
} from './use-cases/prepare-contact-transaction-undo';
export {
  createExactDuplicateChangeSet,
  mergeContactsForProposal,
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
  PrepareContactWrite,
  type PrepareContactWriteRequest,
} from './use-cases/prepare-contact-write';
export {
  ManageCleanupWorkflow,
  type StartCleanupWorkflowRequest,
} from './use-cases/manage-cleanup-workflow';
export {
  CleanupWorkflowResumeError,
  ResumeCleanupWorkflow,
  type ResumedCleanupWorkflow,
} from './use-cases/resume-cleanup-workflow';
export {
  CleanupWorkflowDiscardError,
  DiscardCleanupWorkflow,
} from './use-cases/discard-cleanup-workflow';
export { ExecuteContactWritePlan } from './use-cases/execute-contact-write-plan';
export { carryForwardChangeDecisions } from './use-cases/carry-forward-change-decisions';
export {
  createContactWriteConfirmation,
  type ContactWriteConfirmation,
} from './use-cases/create-contact-write-confirmation';
export {
  acceptedConfirmationTypes,
  requiresContactConfirmation,
} from './use-cases/evaluate-contact-confirmation-policy';
export { resolveMergeConflict, resolveMergeConflictWithCustomName } from './use-cases/resolve-merge-conflict';
export {
  decorateProposedContact,
  ContactDecorationConflictError,
} from './use-cases/decorate-proposed-contact';
export {
  CreatePerChangeCleanupWorkflows,
  isPerChangeCleanupWorkflow,
} from './use-cases/create-per-change-cleanup-workflows';
export { ReconcileUnknownContactWrite } from './use-cases/reconcile-unknown-contact-write';
export { WithMaterializedContactPhotos } from './use-cases/with-materialized-contact-photos';
export { ResumeContactWriteFinalization } from './use-cases/resume-contact-write-finalization';
export { ResumeContactWriteVerification } from './use-cases/resume-contact-write-verification';
export { getCompletedTransactionResultContactId } from './use-cases/get-completed-transaction-result-contact-id';
export {
  ContactWriteAuthorization,
  ContactWriteCapabilityError,
  ContactWriteCapabilityGate,
  type ContactWriteDenialReason,
  type ContactWriteRuntimePrerequisites,
  type ContactWriterCertification,
  type ContactWriterPlatform,
} from './services/contact-write-capability-gate';
export { PhotoMaterializingContactWriter } from './services/photo-materializing-contact-writer';
export {
  ReadContactSource,
  type ReadContactSourceDependencies,
  type ReadContactSourceRequest,
} from './use-cases/read-contact-source';
