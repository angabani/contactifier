import type { CanonicalContact, StructuredName } from '../contacts/contact';

export type MergeConflictField = 'name' | 'organizations';

export interface MergeConflictOption {
  readonly sourceContactId: string;
  readonly sourceName: string;
  readonly displayValue: string;
}

export interface MergeConflict {
  readonly field: MergeConflictField;
  readonly title: string;
  readonly options: readonly MergeConflictOption[];
}

function text(value: string | undefined): string {
  return value?.trim() ?? '';
}

function nameKey(value: StructuredName | undefined): string {
  return JSON.stringify(value
    ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, text(item)]))
    : {});
}

function nameDisplay(contact: CanonicalContact): string {
  return contact.displayName.trim() || [
    contact.name?.prefix,
    contact.name?.givenName,
    contact.name?.middleName,
    contact.name?.familyName,
    contact.name?.suffix,
  ].map(text).filter(Boolean).join(' ') || 'Unnamed contact';
}

function organizationsKey(value: CanonicalContact['organizations']): string {
  return JSON.stringify(value.map(({ value: organization }) => ({
    name: text(organization.name),
    department: text(organization.department),
    title: text(organization.title),
    role: text(organization.role),
  })));
}

function organizationsDisplay(value: CanonicalContact['organizations']): string {
  return value.flatMap(({ value: { name, department, title, role } }) => [name, department, title, role])
    .map(text).filter(Boolean).join(' · ') || 'No organization';
}

function conflict(
  field: MergeConflictField,
  title: string,
  contacts: readonly CanonicalContact[],
  key: (contact: CanonicalContact) => string,
  display: (contact: CanonicalContact) => string,
): MergeConflict | undefined {
  const distinct = new Map<string, CanonicalContact>();
  for (const contact of contacts) distinct.set(key(contact), contact);
  if (distinct.size < 2) return undefined;
  return Object.freeze({
    field,
    title,
    options: Object.freeze([...distinct.values()].map((contact) => ({
      sourceContactId: contact.id,
      sourceName: contact.displayName || 'Unnamed contact',
      displayValue: display(contact),
    }))),
  });
}

export function findMergeConflicts(contacts: readonly CanonicalContact[]): readonly MergeConflict[] {
  return Object.freeze([
    conflict('name', 'Choose the contact name', contacts, ({ name, displayName }) =>
      `${nameKey(name)}:${displayName.trim()}`, nameDisplay),
    conflict('organizations', 'Choose organization information', contacts,
      ({ organizations }) => organizationsKey(organizations),
      ({ organizations }) => organizationsDisplay(organizations)),
  ].filter((value): value is MergeConflict => Boolean(value)));
}

export function mergeConflictResultMatchesSource(input: {
  readonly field: MergeConflictField;
  readonly result: CanonicalContact;
  readonly sources: readonly CanonicalContact[];
}): boolean {
  return input.sources.some((source) => input.field === 'name'
    ? source.displayName === input.result.displayName && nameKey(source.name) === nameKey(input.result.name)
    : organizationsKey(source.organizations) === organizationsKey(input.result.organizations));
}
