export type {
  BackupArtifact,
  BackupChunk,
  BackupEncryption,
  BackupId,
  BackupManifest,
  BackupPhotoAsset,
} from './backups/backup-manifest';
export { chunkContacts } from './backups/chunk-contacts';
export { validateBackupManifest } from './backups/validate-backup-manifest';
export {
  contactSemanticDifferences,
  contactsSemanticallyEqual,
  createContactRestorePlan,
} from './backups/restore-plan';
export type {
  ContactRestorePlan,
  RestorePlanItem,
  RestorePlanItemKind,
  RestoreField,
} from './backups/restore-plan';
export type {
  ChangeDecision,
  ChangeOrigin,
  ContactDecoration,
  ChangeSet,
  ContactDeleteChange,
  ContactMergeChange,
  ContactUpdateChange,
  ProposedChange,
  ProposedChangeId,
} from './changes/proposed-change';
export { createChangeSet } from './changes/create-change-set';
export {
  applyAcceptedChangeSet,
  ChangeApplicationError,
  rollbackAppliedChangeSet,
} from './changes/apply-change-set';
export {
  compensationsForExecutedOperations,
  ContactWritePlanError,
  createDryRunContactWritePlan,
  splitContactWritePlanByChange,
  validateContactWritePlan,
} from './changes/contact-write-plan';
export type {
  ContactWriteCompensation,
  ContactWriteOperation,
  ContactWritePlan,
  ContactWritePlanErrorCode,
  PerChangeContactWritePlan,
} from './changes/contact-write-plan';
export type {
  AppliedChangeSet,
  AppliedMutationReceipt,
  ChangeApplicationErrorCode,
} from './changes/apply-change-set';
export type {
  CanonicalContact,
  ContactDate,
  ContactEvent,
  ContactFieldOrigin,
  ContactId,
  ContactPhotoRef,
  ContactValue,
  ContactValueId,
  Organization,
  PhoneNumber,
  PostalAddress,
  StructuredName,
} from './contacts/contact';
export { createContactDate } from './contacts/contact-date';
export { createContactSnapshot } from './contacts/create-contact-snapshot';
export { compareContactSnapshots } from './contacts/contact-snapshot-delta';
export type { ContactSnapshotDelta } from './contacts/contact-snapshot-delta';
export type {
  ContactAccessScope,
  ContactSnapshot,
  ContactSnapshotId,
} from './contacts/contact-snapshot';
export type { ContactRecordRef, ContactSourceKind, ContactSourceRef } from './contacts/contact-source';
export { isSameContactSource } from './contacts/contact-source';
export type {
  MergeCandidate,
  MergeCandidateDecision,
  MergeCandidateId,
  MergeSignal,
  MergeSignalKind,
} from './merging/merge-candidate';
export { findMergeConflicts, mergeConflictResultMatchesSource } from './merging/merge-conflicts';
export type {
  MergeConflict,
  MergeConflictField,
  MergeConflictOption,
} from './merging/merge-conflicts';
export {
  analyzeExactDuplicates,
  DEFAULT_EXACT_DUPLICATE_MATCH_LIMIT,
  normalizeEmailForExactMatch,
  normalizePhoneForExactMatch,
} from './merging/exact-duplicate-analysis';
export type {
  ExactDuplicateAnalysis,
  ExactDuplicateMatch,
  ExactDuplicateSignal,
  ExactDuplicateSignalKind,
} from './merging/exact-duplicate-analysis';
export { createConfidenceScore } from './shared/confidence-score';
export type { ConfidenceScore } from './shared/confidence-score';
export { analyzeContactQuality } from './quality/contact-quality-analysis';
export type {
  ContactQualityAnalysis,
  ContactQualityFinding,
  ContactQualityIssueKind,
} from './quality/contact-quality-analysis';
export { assertDomain, DomainValidationError } from './shared/invariant';
export type { JsonObject, JsonPrimitive, JsonValue } from './shared/json';
export {
  CleanupWorkflowTransitionError,
  createCleanupWorkflow,
  recordWorkflowPreflight,
  recordWorkflowOperation,
  recordWorkflowCompensation,
  recordWorkflowFinalization,
  recordWorkflowReconciliation,
  recordWorkflowRollbackCause,
  recordWorkflowReview,
  transitionCleanupWorkflow,
  validateCleanupWorkflow,
  workflowUsesSource,
} from './workflows/cleanup-workflow';
export type {
  CleanupWorkflow,
  CleanupWorkflowFailure,
  CleanupWorkflowJournalEntry,
  CleanupWorkflowRollbackCause,
  ContactWriteReceipt,
  ContactWriteCompensationReceipt,
  ContactWriteFinalizationReceipt,
  CleanupWorkflowPhase,
} from './workflows/cleanup-workflow';
