import { contactsSemanticallyEqual, type CanonicalContact } from '@/domain';

import { IOS_FIXTURE_MARKER_PREFIX } from './ios-certification-fixtures';

export interface SimulatorFixtureRestoreIdentity {
  readonly sourceAliases: ReadonlyMap<string, string>;
  readonly redundantContacts: readonly CanonicalContact[];
}

function fixtureMarkers(contact: CanonicalContact): readonly string[] {
  return contact.urls
    .map(({ value }) => value.trim())
    .filter((value) => value.startsWith(IOS_FIXTURE_MARKER_PREFIX));
}

/**
 * Reconciles fixture identity independently of the native contact identifier.
 * iOS assigns a new identifier when a deleted contact is recreated, while the
 * fixture ownership URL remains stable across that lifecycle.
 */
export function reconcileSimulatorFixtureRestoreIdentity(
  backupContacts: readonly CanonicalContact[],
  currentContacts: readonly CanonicalContact[],
): SimulatorFixtureRestoreIdentity {
  const currentByMarker = new Map<string, CanonicalContact[]>();
  for (const contact of currentContacts) {
    for (const marker of fixtureMarkers(contact)) {
      const matches = currentByMarker.get(marker) ?? [];
      matches.push(contact);
      currentByMarker.set(marker, matches);
    }
  }

  const aliases = new Map<string, string>();
  const redundant = new Map<string, CanonicalContact>();
  for (const backup of backupContacts) {
    const marker = fixtureMarkers(backup)[0];
    if (!marker) continue;
    const matches = [...(currentByMarker.get(marker) ?? [])].sort((left, right) =>
      left.recordRef.sourceContactId.localeCompare(right.recordRef.sourceContactId),
    );
    if (matches.length === 0) continue;

    const backupSourceId = backup.recordRef.sourceContactId;
    const original = matches.find(
      ({ recordRef }) => recordRef.sourceContactId === backupSourceId,
    );
    const exact = matches.filter((current) => contactsSemanticallyEqual(backup, current));
    const keeper = original ?? exact[0] ?? (matches.length === 1 ? matches[0] : undefined);
    if (!keeper) continue;

    const keeperSourceId = keeper.recordRef.sourceContactId;
    if (keeperSourceId !== backupSourceId) aliases.set(backupSourceId, keeperSourceId);
    for (const duplicate of exact) {
      const duplicateSourceId = duplicate.recordRef.sourceContactId;
      if (duplicateSourceId !== keeperSourceId) redundant.set(duplicateSourceId, duplicate);
    }
  }

  for (const keeperSourceId of aliases.values()) redundant.delete(keeperSourceId);
  return Object.freeze({
    sourceAliases: aliases,
    redundantContacts: Object.freeze([...redundant.values()]),
  });
}
