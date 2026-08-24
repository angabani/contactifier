import type { CanonicalContact } from '@/domain';

export interface ContactReviewValue {
  readonly id: string;
  readonly kind: 'email' | 'phone';
  readonly label: string;
  readonly value: string;
}

export type MergePreviewValueStatus = 'kept' | 'added' | 'duplicate-collapsed';

export interface MergePreviewValue extends ContactReviewValue {
  readonly status: MergePreviewValueStatus;
  readonly sourceContactIds: readonly string[];
  readonly sourceNames: readonly string[];
}

export interface MergePreviewPresentation {
  readonly sources: readonly {
    readonly contact: CanonicalContact;
    readonly values: readonly ContactReviewValue[];
  }[];
  readonly result: CanonicalContact;
  readonly values: readonly MergePreviewValue[];
}

export function contactReviewValues(contact: CanonicalContact): readonly ContactReviewValue[] {
  return Object.freeze([
    ...contact.phoneNumbers.map((item) => ({
      id: `phone:${item.id}`,
      kind: 'phone' as const,
      label: item.label?.trim() || 'Phone',
      value: item.value.raw,
    })),
    ...contact.emailAddresses.map((item) => ({
      id: `email:${item.id}`,
      kind: 'email' as const,
      label: item.label?.trim() || 'Email',
      value: item.value,
    })),
  ]);
}

function identity(value: ContactReviewValue): string {
  if (value.kind === 'email') return `email:${value.value.trim().toLocaleLowerCase('en-US')}`;
  const trimmed = value.value.trim();
  const digits = trimmed.replace(/\D/g, '');
  return `phone:${trimmed.startsWith('+') ? '+' : ''}${digits}`;
}

export function createMergePreviewPresentation(input: {
  readonly sources: readonly CanonicalContact[];
  readonly result: CanonicalContact;
}): MergePreviewPresentation {
  const sources = input.sources.map((contact) => ({
    contact,
    values: contactReviewValues(contact),
  }));
  const occurrences = new Map<string, CanonicalContact[]>();
  for (const source of sources) {
    for (const value of source.values) {
      const key = identity(value);
      const contacts = occurrences.get(key) ?? [];
      if (!contacts.some(({ id }) => id === source.contact.id)) contacts.push(source.contact);
      occurrences.set(key, contacts);
    }
  }
  const primarySourceId = input.sources[0]?.id;
  const values = contactReviewValues(input.result).map((value): MergePreviewValue => {
    const contacts = occurrences.get(identity(value)) ?? [];
    const status: MergePreviewValueStatus = contacts.length > 1
      ? 'duplicate-collapsed'
      : contacts.some(({ id }) => id === primarySourceId) ? 'kept' : 'added';
    return {
      ...value,
      status,
      sourceContactIds: Object.freeze(contacts.map(({ id }) => id)),
      sourceNames: Object.freeze(contacts.map(({ displayName }) => displayName || 'Unnamed contact')),
    };
  });
  return Object.freeze({ sources: Object.freeze(sources), result: input.result, values: Object.freeze(values) });
}
