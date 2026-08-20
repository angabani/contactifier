import type { CanonicalContact, ContactAccessScope, ContactSourceRef } from '@/domain';

export interface ContactReadResult {
  readonly contacts: readonly CanonicalContact[];
  readonly sourceRevision?: string;
  readonly contentHash?: string;
  readonly accessScope?: ContactAccessScope;
}

/** Implemented by source-specific infrastructure such as Expo Contacts or Google People. */
export interface ContactReader {
  readContacts(source: ContactSourceRef): Promise<ContactReadResult>;
}

export class ContactPermissionDeniedError extends Error {
  constructor(readonly canAskAgain: boolean) {
    super('Permission to read contacts was denied.');
    this.name = 'ContactPermissionDeniedError';
  }
}
