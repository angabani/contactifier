import type { CanonicalContact, ContactId, PhoneNumber } from '../contacts/contact';
import type { ContactSnapshot } from '../contacts/contact-snapshot';

export type ExactDuplicateSignalKind = 'email' | 'phone';

export interface ExactDuplicateSignal {
  readonly kind: ExactDuplicateSignalKind;
  readonly normalizedValue: string;
}

export interface ExactDuplicateMatch {
  readonly id: string;
  readonly contactIds: readonly [ContactId, ContactId];
  readonly signals: readonly ExactDuplicateSignal[];
}

export interface ExactDuplicateAnalysis {
  readonly matches: readonly ExactDuplicateMatch[];
  readonly affectedContactIds: readonly ContactId[];
  readonly emailMatchCount: number;
  readonly phoneMatchCount: number;
}

export function normalizeEmailForExactMatch(value: string): string | null {
  const normalized = value.trim().toLocaleLowerCase('en-US');
  const parts = normalized.split('@');
  return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0
    ? normalized
    : null;
}

export function normalizePhoneForExactMatch(value: PhoneNumber): string | null {
  const input = (value.normalized ?? value.raw).trim();
  const hasLeadingPlus = input.startsWith('+');
  const digits = input.replace(/\D/g, '');

  if (digits.length < 7) {
    return null;
  }

  return hasLeadingPlus ? `+${digits}` : digits;
}

function pairs(contactIds: readonly ContactId[]): readonly [ContactId, ContactId][] {
  const result: [ContactId, ContactId][] = [];
  for (let left = 0; left < contactIds.length; left += 1) {
    for (let right = left + 1; right < contactIds.length; right += 1) {
      result.push([contactIds[left], contactIds[right]]);
    }
  }
  return result;
}

function indexValues(
  contacts: readonly CanonicalContact[],
  valuesForContact: (contact: CanonicalContact) => readonly string[],
): Map<string, Set<ContactId>> {
  const index = new Map<string, Set<ContactId>>();
  for (const contact of contacts) {
    for (const value of new Set(valuesForContact(contact))) {
      const contactIds = index.get(value) ?? new Set<ContactId>();
      contactIds.add(contact.id);
      index.set(value, contactIds);
    }
  }
  return index;
}

export function analyzeExactDuplicates(snapshot: ContactSnapshot): ExactDuplicateAnalysis {
  const pairSignals = new Map<string, { contactIds: [ContactId, ContactId]; signals: ExactDuplicateSignal[] }>();

  const indexes: readonly [ExactDuplicateSignalKind, Map<string, Set<ContactId>>][] = [
    [
      'phone',
      indexValues(snapshot.contacts, (contact) =>
        contact.phoneNumbers.flatMap(({ value }) => {
          const normalized = normalizePhoneForExactMatch(value);
          return normalized ? [normalized] : [];
        }),
      ),
    ],
    [
      'email',
      indexValues(snapshot.contacts, (contact) =>
        contact.emailAddresses.flatMap(({ value }) => {
          const normalized = normalizeEmailForExactMatch(value);
          return normalized ? [normalized] : [];
        }),
      ),
    ],
  ];

  for (const [kind, index] of indexes) {
    for (const [normalizedValue, contactIds] of index) {
      if (contactIds.size < 2) continue;

      for (const contactPair of pairs([...contactIds].sort())) {
        const key = contactPair.join('\u0000');
        const match = pairSignals.get(key) ?? { contactIds: contactPair, signals: [] };
        match.signals.push({ kind, normalizedValue });
        pairSignals.set(key, match);
      }
    }
  }

  const matches = [...pairSignals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, match]) => Object.freeze({ id, ...match, signals: Object.freeze(match.signals) }));
  const affectedContactIds = [...new Set(matches.flatMap(({ contactIds }) => contactIds))].sort();

  return Object.freeze({
    matches: Object.freeze(matches),
    affectedContactIds: Object.freeze(affectedContactIds),
    emailMatchCount: matches.filter(({ signals }) => signals.some(({ kind }) => kind === 'email')).length,
    phoneMatchCount: matches.filter(({ signals }) => signals.some(({ kind }) => kind === 'phone')).length,
  });
}
