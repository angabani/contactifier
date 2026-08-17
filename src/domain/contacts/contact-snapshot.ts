import type { CanonicalContact } from './contact';
import type { ContactSourceRef } from './contact-source';

export type ContactSnapshotId = string;
export type ContactAccessScope = 'all' | 'limited';

export interface ContactSnapshot {
  readonly id: ContactSnapshotId;
  readonly schemaVersion: 1;
  readonly source: ContactSourceRef;
  readonly accessScope?: ContactAccessScope;
  readonly createdAt: string;
  readonly sourceRevision?: string;
  readonly contentHash?: string;
  readonly contacts: readonly CanonicalContact[];
}
