export type { BackupArtifact, BackupEncryption, BackupId, BackupManifest } from './backups/backup-manifest';
export type {
  ChangeDecision,
  ChangeOrigin,
  ChangeSet,
  ContactMergeChange,
  ContactUpdateChange,
  ProposedChange,
  ProposedChangeId,
} from './changes/proposed-change';
export { createChangeSet } from './changes/create-change-set';
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
export type { ContactSnapshot, ContactSnapshotId } from './contacts/contact-snapshot';
export type { ContactRecordRef, ContactSourceKind, ContactSourceRef } from './contacts/contact-source';
export { isSameContactSource } from './contacts/contact-source';
export type {
  MergeCandidate,
  MergeCandidateDecision,
  MergeCandidateId,
  MergeSignal,
  MergeSignalKind,
} from './merging/merge-candidate';
export { createConfidenceScore } from './shared/confidence-score';
export type { ConfidenceScore } from './shared/confidence-score';
export { assertDomain, DomainValidationError } from './shared/invariant';
export type { JsonObject, JsonPrimitive, JsonValue } from './shared/json';
