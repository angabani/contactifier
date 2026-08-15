import { assertDomain } from '../shared/invariant';
import type { ContactSnapshot } from './contact-snapshot';
import { isSameContactSource } from './contact-source';

export function createContactSnapshot(snapshot: ContactSnapshot): ContactSnapshot {
  assertDomain(snapshot.id.trim().length > 0, 'Contact snapshot id is required.');
  assertDomain(
    !Number.isNaN(Date.parse(snapshot.createdAt)),
    'Contact snapshot createdAt must be a valid date-time.',
  );

  const contactIds = new Set<string>();
  for (const contact of snapshot.contacts) {
    assertDomain(
      !contactIds.has(contact.id),
      `Contact snapshot contains duplicate contact id: ${contact.id}.`,
    );
    assertDomain(
      isSameContactSource(contact.recordRef.source, snapshot.source),
      `Contact ${contact.id} belongs to a different source.`,
    );
    contactIds.add(contact.id);
  }

  return Object.freeze({ ...snapshot, contacts: Object.freeze([...snapshot.contacts]) });
}
