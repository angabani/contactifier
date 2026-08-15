import type { CanonicalContact, ContactSourceRef } from '@/domain';

export interface ContactReadResult {
  readonly contacts: readonly CanonicalContact[];
  readonly sourceRevision?: string;
  readonly contentHash?: string;
}

/** Implemented by source-specific infrastructure such as Expo Contacts or Google People. */
export interface ContactReader {
  readContacts(source: ContactSourceRef): Promise<ContactReadResult>;
}
