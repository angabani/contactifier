import type { CanonicalContact, ContactValue, PhoneNumber, StructuredName } from '../contacts/contact';
import type { ContactSnapshot } from '../contacts/contact-snapshot';
import { normalizeEmailForExactMatch, normalizePhoneForExactMatch } from '../merging/exact-duplicate-analysis';

export type ContactQualityIssueKind =
  | 'duplicate-email'
  | 'duplicate-phone'
  | 'empty-contact'
  | 'missing-name'
  | 'name-symbols'
  | 'whitespace';

export interface ContactQualityFinding {
  readonly contactId: string;
  readonly issueKinds: readonly ContactQualityIssueKind[];
  readonly suggestedAction: 'delete' | 'none' | 'update';
  readonly before: CanonicalContact;
  readonly after?: CanonicalContact;
}

export interface ContactQualityAnalysis {
  readonly findings: readonly ContactQualityFinding[];
  readonly affectedContactIds: readonly string[];
  readonly updateCount: number;
  readonly deleteCandidateCount: number;
  readonly missingNameCount: number;
}

function deduplicate<T>(
  values: readonly ContactValue<T>[],
  keyFor: (value: T) => string | null,
): readonly ContactValue<T>[] {
  const seen = new Set<string>();
  return values.filter(({ value, id }) => {
    const key = keyFor(value) ?? `unmatched:${id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function trimmedName(name: StructuredName | undefined): StructuredName | undefined {
  if (!name) return undefined;
  return Object.fromEntries(
    Object.entries(name).flatMap(([key, value]) => {
      const trimmed = value?.trim();
      return trimmed ? [[key, trimmed]] : [];
    }),
  );
}

function uniformNamePart(value: string): string {
  return value
    .replace(/[^\p{L}\p{M}\p{N}\s.,'’\-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniformName(name: StructuredName | undefined): StructuredName | undefined {
  if (!name) return undefined;
  return Object.fromEntries(
    Object.entries(name).flatMap(([key, value]) => {
      const cleaned = value ? uniformNamePart(value) : '';
      return cleaned ? [[key, cleaned]] : [];
    }),
  );
}

function hasName(contact: CanonicalContact): boolean {
  return Boolean(
    contact.displayName.trim() ||
      (contact.name && Object.values(contact.name).some((value) => value?.trim())),
  );
}

function isTrulyEmpty(contact: CanonicalContact): boolean {
  return (
    !hasName(contact) &&
    contact.nicknames.length === 0 &&
    contact.phoneNumbers.length === 0 &&
    contact.emailAddresses.length === 0 &&
    contact.postalAddresses.length === 0 &&
    contact.organizations.length === 0 &&
    contact.urls.length === 0 &&
    contact.birthdays.length === 0 &&
    contact.events.length === 0 &&
    contact.notes.length === 0 &&
    contact.groups.length === 0 &&
    contact.photos.length === 0 &&
    Object.keys(contact.extensions).length === 0
  );
}

function analyzeContact(contact: CanonicalContact): ContactQualityFinding | null {
  const issueKinds = new Set<ContactQualityIssueKind>();
  const phoneNumbers = deduplicate<PhoneNumber>(contact.phoneNumbers, normalizePhoneForExactMatch);
  const emailAddresses = deduplicate(contact.emailAddresses, normalizeEmailForExactMatch).map(
    (email) => ({ ...email, value: email.value.trim() }),
  );
  const trimmedStructuredName = trimmedName(contact.name);
  const name = uniformName(trimmedStructuredName);
  const trimmedDisplayName = contact.displayName.trim();
  const displayName = uniformNamePart(trimmedDisplayName);

  if (
    displayName !== trimmedDisplayName ||
    JSON.stringify(name) !== JSON.stringify(trimmedStructuredName)
  ) issueKinds.add('name-symbols');

  if (phoneNumbers.length !== contact.phoneNumbers.length) issueKinds.add('duplicate-phone');
  if (emailAddresses.length !== contact.emailAddresses.length) issueKinds.add('duplicate-email');
  if (
    trimmedDisplayName !== contact.displayName ||
    JSON.stringify(trimmedStructuredName) !== JSON.stringify(contact.name) ||
    emailAddresses.some((email, index) => email.value !== contact.emailAddresses[index]?.value)
  ) {
    issueKinds.add('whitespace');
  }
  if (!hasName(contact)) issueKinds.add('missing-name');
  if (isTrulyEmpty(contact)) issueKinds.add('empty-contact');
  if (issueKinds.size === 0) return null;

  const canUpdate =
    issueKinds.has('duplicate-phone') ||
    issueKinds.has('duplicate-email') ||
    issueKinds.has('name-symbols') ||
    issueKinds.has('whitespace');
  const after = canUpdate
    ? { ...contact, displayName, name, phoneNumbers, emailAddresses }
    : undefined;
  return Object.freeze({
    contactId: contact.id,
    issueKinds: Object.freeze([...issueKinds].sort()),
    suggestedAction: issueKinds.has('empty-contact') ? 'delete' : canUpdate ? 'update' : 'none',
    before: contact,
    after,
  });
}

export function analyzeContactQuality(snapshot: ContactSnapshot): ContactQualityAnalysis {
  const findings = snapshot.contacts.flatMap((contact) => {
    const finding = analyzeContact(contact);
    return finding ? [finding] : [];
  });
  return Object.freeze({
    findings: Object.freeze(findings),
    affectedContactIds: Object.freeze(findings.map(({ contactId }) => contactId).sort()),
    updateCount: findings.filter(({ suggestedAction }) => suggestedAction === 'update').length,
    deleteCandidateCount: findings.filter(({ suggestedAction }) => suggestedAction === 'delete').length,
    missingNameCount: findings.filter(({ issueKinds }) => issueKinds.includes('missing-name')).length,
  });
}
