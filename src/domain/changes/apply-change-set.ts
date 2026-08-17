import { contactsSemanticallyEqual } from '../backups/restore-plan';
import type { CanonicalContact, ContactId } from '../contacts/contact';
import { createContactSnapshot } from '../contacts/create-contact-snapshot';
import { isSameContactSource } from '../contacts/contact-source';
import type { ContactSnapshot } from '../contacts/contact-snapshot';
import { createChangeSet } from './create-change-set';
import type { ChangeSet, ProposedChange } from './proposed-change';

export type ChangeApplicationErrorCode =
  | 'backup-mismatch'
  | 'contact-missing'
  | 'contact-overlap'
  | 'invalid-decision'
  | 'snapshot-mismatch'
  | 'source-mismatch'
  | 'stale-contact'
  | 'target-collision';

export class ChangeApplicationError extends Error {
  constructor(readonly code: ChangeApplicationErrorCode, message: string) {
    super(message);
    this.name = 'ChangeApplicationError';
  }
}

export interface AppliedMutationReceipt {
  readonly changeSetId: string;
  readonly snapshotIdBefore: string;
  readonly touchedContactIds: readonly ContactId[];
  readonly createdContactIds: readonly ContactId[];
}

export interface AppliedChangeSet {
  readonly snapshot: ContactSnapshot;
  readonly receipt: AppliedMutationReceipt;
}

function touchedIds(change: ProposedChange): readonly ContactId[] {
  return change.kind === 'merge' ? change.contactIds : [change.contactId];
}

function requireCurrent(
  contacts: ReadonlyMap<ContactId, CanonicalContact>,
  expected: CanonicalContact,
): CanonicalContact {
  const current = contacts.get(expected.id);
  if (!current) {
    throw new ChangeApplicationError(
      'contact-missing',
      `Contact ${expected.id} is missing from the current snapshot.`,
    );
  }
  if (!contactsSemanticallyEqual(current, expected)) {
    throw new ChangeApplicationError(
      'stale-contact',
      `Contact ${expected.id} changed after analysis.`,
    );
  }
  return current;
}

export function applyAcceptedChangeSet(
  snapshot: ContactSnapshot,
  changeSet: ChangeSet,
): AppliedChangeSet {
  const validatedChangeSet = createChangeSet(changeSet);

  if (snapshot.id !== validatedChangeSet.snapshotId) {
    throw new ChangeApplicationError('snapshot-mismatch', 'Change set targets another snapshot.');
  }
  if (validatedChangeSet.changes.some(({ decision }) => decision === 'pending')) {
    throw new ChangeApplicationError(
      'invalid-decision',
      'Every proposed change must have an explicit decision before apply.',
    );
  }

  const accepted = validatedChangeSet.changes.filter(({ decision }) => decision === 'accepted');
  const contacts = new Map(snapshot.contacts.map((contact) => [contact.id, contact]));
  const touched = new Set<ContactId>();
  const created = new Set<ContactId>();

  for (const change of accepted) {
    for (const contactId of touchedIds(change)) {
      if (touched.has(contactId)) {
        throw new ChangeApplicationError(
          'contact-overlap',
          `Contact ${contactId} is targeted by more than one accepted change.`,
        );
      }
      touched.add(contactId);
    }

    if (change.kind === 'merge') {
      for (const before of change.before) requireCurrent(contacts, before);
      if (!change.contactIds.includes(change.after.id) && contacts.has(change.after.id)) {
        throw new ChangeApplicationError(
          'target-collision',
          `Merge target ${change.after.id} already exists.`,
        );
      }
      if (!change.contactIds.includes(change.after.id)) created.add(change.after.id);
    } else {
      requireCurrent(contacts, change.before);
    }

    const output = change.kind === 'delete' ? undefined : change.after;
    if (output && !isSameContactSource(snapshot.source, output.recordRef.source)) {
      throw new ChangeApplicationError(
        'source-mismatch',
        `Change ${change.id} produces a contact from another source.`,
      );
    }
  }

  for (const change of accepted) {
    if (change.kind === 'delete') {
      contacts.delete(change.contactId);
    } else if (change.kind === 'update') {
      contacts.set(change.contactId, change.after);
    } else {
      for (const contactId of change.contactIds) contacts.delete(contactId);
      contacts.set(change.after.id, change.after);
    }
  }

  return {
    snapshot: createContactSnapshot({
      ...snapshot,
      id: `${snapshot.id}:applied:${validatedChangeSet.id}`,
      createdAt: validatedChangeSet.createdAt,
      contacts: [...contacts.values()],
    }),
    receipt: Object.freeze({
      changeSetId: validatedChangeSet.id,
      snapshotIdBefore: snapshot.id,
      touchedContactIds: Object.freeze([...touched]),
      createdContactIds: Object.freeze([...created]),
    }),
  };
}

export function rollbackAppliedChangeSet(
  current: ContactSnapshot,
  backup: ContactSnapshot,
  receipt: AppliedMutationReceipt,
  rolledBackAt: string,
): ContactSnapshot {
  if (backup.id !== receipt.snapshotIdBefore) {
    throw new ChangeApplicationError(
      'backup-mismatch',
      'Rollback backup does not match the snapshot used for the change set.',
    );
  }
  if (!isSameContactSource(current.source, backup.source)) {
    throw new ChangeApplicationError('source-mismatch', 'Rollback snapshots use different sources.');
  }

  const contacts = new Map(current.contacts.map((contact) => [contact.id, contact]));
  for (const createdId of receipt.createdContactIds) contacts.delete(createdId);
  const backupById = new Map(backup.contacts.map((contact) => [contact.id, contact]));
  for (const touchedId of receipt.touchedContactIds) {
    const original = backupById.get(touchedId);
    if (original) contacts.set(touchedId, original);
  }

  return createContactSnapshot({
    ...backup,
    id: `${current.id}:rollback:${receipt.changeSetId}`,
    createdAt: rolledBackAt,
    contacts: [...contacts.values()],
  });
}
