import type { CanonicalContact, ContactId } from '../contacts/contact';
import type { ConfidenceScore } from '../shared/confidence-score';

export type MergeCandidateId = string;
export type MergeCandidateDecision = 'confirmed' | 'dismissed' | 'pending';

export type MergeSignalKind =
  | 'address'
  | 'email'
  | 'name'
  | 'organization'
  | 'phone';

export interface MergeSignal {
  readonly kind: MergeSignalKind;
  readonly score: ConfidenceScore;
  readonly explanation: string;
}

export interface MergeCandidate {
  readonly id: MergeCandidateId;
  readonly contactIds: readonly ContactId[];
  readonly score: ConfidenceScore;
  readonly signals: readonly MergeSignal[];
  readonly suggestedContact: CanonicalContact;
  readonly decision: MergeCandidateDecision;
}
