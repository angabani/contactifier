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
  type JsonValue,
  type ProposedChange,
  type StructuredName,
} from '@/domain';

export interface CreateExactDuplicateChangeSetInput {
  readonly snapshot: ContactSnapshot;
  readonly analysis: ExactDuplicateAnalysis;
  readonly createdAt: string;
}

function connectedGroups(analysis: ExactDuplicateAnalysis): readonly (readonly string[])[] {
  const neighbors = new Map<string, Set<string>>();
  for (const { contactIds } of analysis.matches) {
    const [left, right] = contactIds;
    const leftNeighbors = neighbors.get(left) ?? new Set<string>();
    const rightNeighbors = neighbors.get(right) ?? new Set<string>();
    leftNeighbors.add(right);
    rightNeighbors.add(left);
    neighbors.set(left, leftNeighbors);
    neighbors.set(right, rightNeighbors);
  }

  const visited = new Set<string>();
  const groups: string[][] = [];
  for (const start of [...neighbors.keys()].sort()) {
    if (visited.has(start)) continue;
    const pending = [start];
    const group: string[] = [];
    visited.add(start);
    while (pending.length > 0) {
      const current = pending.pop()!;
      group.push(current);
      for (const neighbor of [...(neighbors.get(current) ?? [])].sort().reverse()) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          pending.push(neighbor);
        }
      }
    }
    groups.push(group.sort());
  }
  return groups;
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

function combinedName(contacts: readonly CanonicalContact[]): StructuredName | undefined {
  const names = contacts.flatMap(({ name }) => (name ? [name] : []));
  if (names.length === 0) return undefined;
  const fields: (keyof StructuredName)[] = [
    'prefix',
    'givenName',
    'middleName',
    'familyName',
    'suffix',
    'phoneticGivenName',
    'phoneticMiddleName',
    'phoneticFamilyName',
  ];
  return Object.fromEntries(
    fields.flatMap((field) => {
      const value = names.find((name) => name[field]?.trim())?.[field];
      return value ? [[field, value]] : [];
    }),
  );
}

function mergeContacts(contacts: readonly CanonicalContact[]): CanonicalContact {
  const survivor = contacts[0];
  return {
    ...survivor,
    displayName:
      contacts.find(({ displayName }) => displayName.trim())?.displayName ?? survivor.id,
    name: combinedName(contacts),
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
    extensions: contacts.reduce<Record<string, JsonValue>>(
      (result, contact) => ({ ...result, ...contact.extensions }),
      {},
    ),
  };
}

export function createExactDuplicateChangeSet({
  snapshot,
  analysis,
  createdAt,
}: CreateExactDuplicateChangeSetInput): ChangeSet {
  const contactsById = new Map(snapshot.contacts.map((contact) => [contact.id, contact]));
  const proposals: ProposedChange[] = connectedGroups(analysis).map((contactIds) => {
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
      after: mergeContacts(before),
    };
  });

  return createChangeSet({
    id: `exact-duplicates:${snapshot.id}`,
    snapshotId: snapshot.id,
    createdAt,
    changes: proposals,
  });
}
