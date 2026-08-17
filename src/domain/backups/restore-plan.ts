import type { CanonicalContact, ContactId, ContactValue } from '../contacts/contact';
import type { ContactSnapshot } from '../contacts/contact-snapshot';
import { isSameContactSource } from '../contacts/contact-source';
import { assertDomain } from '../shared/invariant';

export type RestorePlanItemKind = 'recreate' | 'unavailable' | 'unchanged' | 'update';
export type RestoreField =
  | 'addresses'
  | 'birthdays'
  | 'emails'
  | 'events'
  | 'extensions'
  | 'groups'
  | 'name'
  | 'nicknames'
  | 'notes'
  | 'organizations'
  | 'phones'
  | 'urls';

export interface RestorePlanItem {
  readonly kind: RestorePlanItemKind;
  readonly backupContact: CanonicalContact;
  readonly currentContact?: CanonicalContact;
  readonly changedFields?: readonly RestoreField[];
}

export interface ContactRestorePlan {
  readonly backupSnapshotId: string;
  readonly currentSnapshotId: string;
  readonly items: readonly RestorePlanItem[];
  readonly unchangedCount: number;
  readonly updateCount: number;
  readonly recreateCount: number;
  readonly unavailableCount: number;
  readonly affectedContactIds: readonly ContactId[];
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined && item !== null && item !== '')
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return typeof value === 'string' ? value.trim() : value;
}

function sortedValues<T>(values: readonly T[]): readonly T[] {
  return [...values].sort((left, right) =>
    JSON.stringify(stableValue(left)).localeCompare(JSON.stringify(stableValue(right))),
  );
}

function normalizedText(value: string): string {
  return value.trim();
}

function normalizedLabel(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLocaleLowerCase('en-US');
  return normalized || undefined;
}

function values<T, R = T>(
  items: readonly ContactValue<T>[],
  transform: (value: T) => R = (value) => value as unknown as R,
): readonly unknown[] {
  return sortedValues(
    items.map(({ value, label, isPrimary }) =>
      stableValue({ value: transform(value), label: normalizedLabel(label), isPrimary }),
    ),
  );
}

function semanticContact(contact: CanonicalContact): Record<RestoreField, unknown> {
  const phone = ({ raw, normalized, countryCode }: CanonicalContact['phoneNumbers'][number]['value']) => {
    const input = (normalized ?? raw).trim();
    const digits = input.replace(/\D/g, '');
    return {
      number: input.startsWith('+') ? `+${digits}` : digits,
      countryCode: countryCode?.trim().toLocaleUpperCase('en-US'),
    };
  };

  return {
    name: stableValue(contact.name),
    nicknames: values(contact.nicknames, normalizedText),
    phones: values(contact.phoneNumbers, phone),
    emails: values(contact.emailAddresses, (email) => email.trim().toLocaleLowerCase('en-US')),
    addresses: values(contact.postalAddresses, stableValue),
    organizations: values(contact.organizations),
    urls: values(contact.urls, normalizedText),
    birthdays: values(contact.birthdays),
    events: values(contact.events, (event) => ({
      date: event.date,
      label: normalizedLabel(event.label),
    })),
    notes: values(contact.notes, normalizedText),
    groups: [...new Set(contact.groups.map(normalizedText))].sort(),
    extensions: stableValue(contact.extensions),
  };
}

export function contactSemanticDifferences(
  left: CanonicalContact,
  right: CanonicalContact,
): readonly RestoreField[] {
  const leftFields = semanticContact(left);
  const rightFields = semanticContact(right);
  return (Object.keys(leftFields) as RestoreField[]).filter(
    (field) => JSON.stringify(leftFields[field]) !== JSON.stringify(rightFields[field]),
  );
}

export function contactsSemanticallyEqual(
  left: CanonicalContact,
  right: CanonicalContact,
): boolean {
  return contactSemanticDifferences(left, right).length === 0;
}

export function createContactRestorePlan(
  backup: ContactSnapshot,
  current: ContactSnapshot,
): ContactRestorePlan {
  assertDomain(
    isSameContactSource(backup.source, current.source),
    'Restore preview requires snapshots from the same contact source.',
  );

  const currentBySourceId = new Map(
    current.contacts.map((contact) => [contact.recordRef.sourceContactId, contact]),
  );
  const items = backup.contacts.map((backupContact): RestorePlanItem => {
    const currentContact = currentBySourceId.get(backupContact.recordRef.sourceContactId);
    if (!currentContact) {
      return {
        kind: current.accessScope === 'limited' ? 'unavailable' : 'recreate',
        backupContact,
      };
    }
    const changedFields = contactSemanticDifferences(backupContact, currentContact);
    return changedFields.length === 0
      ? { kind: 'unchanged', backupContact, currentContact }
      : { kind: 'update', backupContact, currentContact, changedFields };
  });
  const affectedContactIds = items.flatMap(({ kind, backupContact }) =>
    kind === 'update' || kind === 'recreate' ? [backupContact.id] : [],
  );

  return Object.freeze({
    backupSnapshotId: backup.id,
    currentSnapshotId: current.id,
    items: Object.freeze(items),
    unchangedCount: items.filter(({ kind }) => kind === 'unchanged').length,
    updateCount: items.filter(({ kind }) => kind === 'update').length,
    recreateCount: items.filter(({ kind }) => kind === 'recreate').length,
    unavailableCount: items.filter(({ kind }) => kind === 'unavailable').length,
    affectedContactIds: Object.freeze(affectedContactIds),
  });
}
