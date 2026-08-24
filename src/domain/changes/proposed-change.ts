import type { CanonicalContact, ContactId } from '../contacts/contact';
import type { ContactSnapshotId } from '../contacts/contact-snapshot';
import type { ConfidenceScore } from '../shared/confidence-score';
import type { MergeConflictField } from '../merging/merge-conflicts';

export type ProposedChangeId = string;
export type ChangeDecision = 'accepted' | 'pending' | 'rejected' | 'skipped';
export type ChangeOrigin = 'ml' | 'rule' | 'user';
export type ContactDecoration =
  | { readonly kind: 'honorific'; readonly value: string }
  | { readonly kind: 'company'; readonly value: string }
  | { readonly kind: 'designation'; readonly value: string }
  | { readonly kind: 'visible-name-tag'; readonly value: string };

interface ProposedChangeBase {
  readonly id: ProposedChangeId;
  readonly origin: ChangeOrigin;
  readonly confidence: ConfidenceScore;
  readonly reasons: readonly string[];
  readonly decision: ChangeDecision;
  readonly decoration?: ContactDecoration;
}

export interface ContactUpdateChange extends ProposedChangeBase {
  readonly kind: 'update';
  readonly contactId: ContactId;
  readonly before: CanonicalContact;
  readonly after: CanonicalContact;
}

export interface ContactDeleteChange extends ProposedChangeBase {
  readonly kind: 'delete';
  readonly contactId: ContactId;
  readonly before: CanonicalContact;
}

export interface ContactMergeChange extends ProposedChangeBase {
  readonly kind: 'merge';
  readonly contactIds: readonly ContactId[];
  readonly before: readonly CanonicalContact[];
  readonly after: CanonicalContact;
  readonly resolvedConflictFields?: readonly MergeConflictField[];
}

export type ProposedChange = ContactDeleteChange | ContactMergeChange | ContactUpdateChange;

export interface ChangeSet {
  readonly id: string;
  readonly snapshotId: ContactSnapshotId;
  readonly createdAt: string;
  readonly changes: readonly ProposedChange[];
}
