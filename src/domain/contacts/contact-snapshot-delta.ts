import { contactsSemanticallyEqual } from '../backups/restore-plan';
import type { ContactId } from './contact';
import type { ContactSnapshot } from './contact-snapshot';
import { isSameContactSource } from './contact-source';

export interface ContactSnapshotDelta {
  readonly previousSnapshotId?: string;
  readonly currentSnapshotId: string;
  readonly hasBaseline: boolean;
  readonly addedContactIds: readonly ContactId[];
  readonly updatedContactIds: readonly ContactId[];
  readonly deletedContactIds: readonly ContactId[];
  readonly unavailableContactIds: readonly ContactId[];
  readonly unchangedContactIds: readonly ContactId[];
  readonly beautificationContactIds: readonly ContactId[];
}

export function compareContactSnapshots(
  previous: ContactSnapshot | null,
  current: ContactSnapshot,
): ContactSnapshotDelta {
  if (previous && !isSameContactSource(previous.source, current.source)) {
    throw new Error('Cannot compare contact snapshots from different sources.');
  }

  if (!previous) {
    const addedContactIds = current.contacts.map(({ id }) => id).sort();
    return Object.freeze({
      currentSnapshotId: current.id,
      hasBaseline: false,
      addedContactIds: Object.freeze(addedContactIds),
      updatedContactIds: Object.freeze([]),
      deletedContactIds: Object.freeze([]),
      unavailableContactIds: Object.freeze([]),
      unchangedContactIds: Object.freeze([]),
      beautificationContactIds: Object.freeze(addedContactIds),
    });
  }

  const previousBySourceId = new Map(
    previous.contacts.map((contact) => [contact.recordRef.sourceContactId, contact]),
  );
  const currentBySourceId = new Map(
    current.contacts.map((contact) => [contact.recordRef.sourceContactId, contact]),
  );
  const addedContactIds: ContactId[] = [];
  const updatedContactIds: ContactId[] = [];
  const unchangedContactIds: ContactId[] = [];

  for (const contact of current.contacts) {
    const before = previousBySourceId.get(contact.recordRef.sourceContactId);
    if (!before) addedContactIds.push(contact.id);
    else if (contactsSemanticallyEqual(before, contact)) unchangedContactIds.push(contact.id);
    else updatedContactIds.push(contact.id);
  }

  const missing = previous.contacts
    .filter(({ recordRef }) => !currentBySourceId.has(recordRef.sourceContactId))
    .map(({ id }) => id);
  const unavailableContactIds = current.accessScope === 'limited' ? missing : [];
  const deletedContactIds = current.accessScope === 'limited' ? [] : missing;
  const sort = (ids: ContactId[]) => Object.freeze(ids.sort());

  return Object.freeze({
    previousSnapshotId: previous.id,
    currentSnapshotId: current.id,
    hasBaseline: true,
    addedContactIds: sort(addedContactIds),
    updatedContactIds: sort(updatedContactIds),
    deletedContactIds: sort(deletedContactIds),
    unavailableContactIds: sort(unavailableContactIds),
    unchangedContactIds: sort(unchangedContactIds),
    beautificationContactIds: sort([...addedContactIds, ...updatedContactIds]),
  });
}
