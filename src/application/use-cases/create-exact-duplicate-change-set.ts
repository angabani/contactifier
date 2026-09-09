import {
  createChangeSet,
  createConfidenceScore,
  normalizeEmailForExactMatch,
  normalizePhoneForExactMatch,
  type CanonicalContact,
  type ChangeSet,
  type ContactSnapshot,
  type ContactValue,
  type ExactDuplicateAnalysis,
  type ProposedChange,
} from '@/domain';

export interface CreateExactDuplicateChangeSetInput {
  readonly snapshot: ContactSnapshot;
  readonly analysis: ExactDuplicateAnalysis;
  readonly createdAt: string;
}

const MAX_CONTACTS_PER_MERGE_PROPOSAL = 10;

function nonOverlappingExactGroups(
  analysis: ExactDuplicateAnalysis,
): readonly (readonly string[])[] {
  const contactsBySignal = new Map<string, Set<string>>();
  for (const match of analysis.matches) {
    for (const signal of match.signals) {
      const key = `${signal.kind}:${signal.normalizedValue}`;
      const contacts = contactsBySignal.get(key) ?? new Set<string>();
      match.contactIds.forEach((contactId) => contacts.add(contactId));
      contactsBySignal.set(key, contacts);
    }
  }

  const evidenceByMembership = new Map<string, { contactIds: string[]; evidenceCount: number }>();
  for (const contacts of contactsBySignal.values()) {
    const allContactIds = [...contacts].sort();
    for (
      let start = 0;
      start < allContactIds.length;
      start += MAX_CONTACTS_PER_MERGE_PROPOSAL
    ) {
      const contactIds = allContactIds.slice(start, start + MAX_CONTACTS_PER_MERGE_PROPOSAL);
      if (contactIds.length < 2) continue;
      const membership = contactIds.join('\u0000');
      const candidate = evidenceByMembership.get(membership) ?? { contactIds, evidenceCount: 0 };
      candidate.evidenceCount += 1;
      evidenceByMembership.set(membership, candidate);
    }
  }

  const touched = new Set<string>();
  const selected: string[][] = [];
  for (const { contactIds } of [...evidenceByMembership.values()].sort(
    (left, right) =>
      right.evidenceCount - left.evidenceCount ||
      right.contactIds.length - left.contactIds.length ||
      left.contactIds.join('\u0000').localeCompare(right.contactIds.join('\u0000')),
  )) {
    if (contactIds.some((contactId) => touched.has(contactId))) continue;
    contactIds.forEach((contactId) => touched.add(contactId));
    selected.push(contactIds);
  }
  return selected.sort((left, right) =>
    left.join('\u0000').localeCompare(right.join('\u0000')),
  );
}

function uniqueValues<T>(
  contacts: readonly CanonicalContact[],
  select: (contact: CanonicalContact) => readonly ContactValue<T>[],
  semanticKey?: (item: ContactValue<T>) => string | null,
): readonly ContactValue<T>[] {
  const seen = new Set<string>();
  return contacts.flatMap((contact) =>
    select(contact).filter((item) => {
      const key = semanticKey?.(item) ?? JSON.stringify([item.value, item.label]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  );
}

function nameCompleteness(contact: CanonicalContact): number {
  return contact.name
    ? Object.values(contact.name).filter((value) => value?.trim()).length
    : 0;
}

function preferredNamedContact(contacts: readonly CanonicalContact[]): CanonicalContact {
  return contacts.reduce((preferred, contact) =>
    nameCompleteness(contact) > nameCompleteness(preferred) ? contact : preferred,
  );
}

export function mergeContactsForProposal(contacts: readonly CanonicalContact[]): CanonicalContact {
  const survivor = contacts[0];
  const preferredName = preferredNamedContact(contacts);
  return {
    ...survivor,
    displayName: preferredName.displayName.trim() || survivor.displayName.trim(),
    name: preferredName.name,
    nicknames: uniqueValues(contacts, ({ nicknames }) => nicknames),
    phoneNumbers: uniqueValues(
      contacts,
      ({ phoneNumbers }) => phoneNumbers,
      ({ value }) => normalizePhoneForExactMatch(value),
    ),
    emailAddresses: uniqueValues(
      contacts,
      ({ emailAddresses }) => emailAddresses,
      ({ value }) => normalizeEmailForExactMatch(value),
    ),
    postalAddresses: uniqueValues(contacts, ({ postalAddresses }) => postalAddresses),
    organizations: uniqueValues(contacts, ({ organizations }) => organizations),
    urls: uniqueValues(contacts, ({ urls }) => urls),
    birthdays: uniqueValues(contacts, ({ birthdays }) => birthdays),
    events: uniqueValues(contacts, ({ events }) => events),
    notes: uniqueValues(contacts, ({ notes }) => notes),
    groups: [...new Set(contacts.flatMap(({ groups }) => groups))],
    photos: contacts
      .flatMap(({ photos }) => photos)
      .filter(
        (photo, index, all) =>
          all.findIndex(
            (candidate) => candidate.uri === photo.uri && candidate.hash === photo.hash,
          ) === index,
      ),
    extensions: survivor.extensions,
  };
}

export function createExactDuplicateChangeSet({
  snapshot,
  analysis,
  createdAt,
}: CreateExactDuplicateChangeSetInput): ChangeSet {
  const contactsById = new Map(snapshot.contacts.map((contact) => [contact.id, contact]));
  const proposals: ProposedChange[] = nonOverlappingExactGroups(analysis).map((contactIds) => {
    const before = contactIds.map((id) => {
      const contact = contactsById.get(id);
      if (!contact) throw new Error(`Duplicate analysis references missing contact ${id}.`);
      return contact;
    });
    const matches = analysis.matches.filter(({ contactIds: pair }) =>
      pair.every((id) => contactIds.includes(id)),
    );
    const signalKinds = new Set(
      matches.flatMap(({ signals }) => signals.map(({ kind }) => kind)),
    );
    return {
      id: `merge:${contactIds.join(':')}`,
      kind: 'merge',
      origin: 'rule',
      confidence: createConfidenceScore(signalKinds.size > 1 ? 0.99 : 0.97),
      reasons: [...signalKinds].sort().map((kind) => `Same exact ${kind}`),
      decision: 'pending',
      contactIds,
      before,
      after: mergeContactsForProposal(before),
    };
  });

  return createChangeSet({
    id: `exact-duplicates:${snapshot.id}`,
    snapshotId: snapshot.id,
    createdAt,
    changes: proposals,
  });
}
