import { assertDomain } from '../shared/invariant';
import { isSameContactSource } from '../contacts/contact-source';
import type { ChangeSet, ProposedChange } from './proposed-change';

function validateChange(change: ProposedChange): void {
  assertDomain(change.id.trim().length > 0, 'Proposed change id is required.');
  assertDomain(
    change.reasons.length > 0 && change.reasons.every((reason) => reason.trim().length > 0),
    `Change ${change.id} must include a reason.`,
  );
  assertDomain(
    Number.isFinite(change.confidence) && change.confidence >= 0 && change.confidence <= 1,
    `Change ${change.id} has an invalid confidence score.`,
  );
  assertDomain(
    ['accepted', 'pending', 'rejected', 'skipped'].includes(change.decision),
    `Change ${change.id} has an invalid decision.`,
  );
  assertDomain(
    ['ml', 'rule', 'user'].includes(change.origin),
    `Change ${change.id} has an invalid origin.`,
  );

  if (change.kind === 'delete') {
    assertDomain(
      change.before.id === change.contactId,
      `Delete ${change.id} must reference its before-state contact id.`,
    );
    return;
  }

  if (change.kind === 'update') {
    assertDomain(
      change.before.id === change.contactId && change.after.id === change.contactId,
      `Update ${change.id} must preserve its contact id.`,
    );
    assertDomain(
      change.before.recordRef.sourceContactId === change.after.recordRef.sourceContactId,
      `Update ${change.id} must preserve its source contact id.`,
    );
    assertDomain(
      isSameContactSource(change.before.recordRef.source, change.after.recordRef.source),
      `Update ${change.id} must preserve its contact source.`,
    );
    return;
  }

  const beforeIds = new Set(change.before.map(({ id }) => id));
  assertDomain(
    new Set(change.contactIds).size >= 2,
    `Merge ${change.id} must contain at least two distinct contacts.`,
  );
  assertDomain(
    beforeIds.size === change.contactIds.length &&
      change.contactIds.every((contactId) => beforeIds.has(contactId)),
    `Merge ${change.id} must include a before-state for every contact.`,
  );
  const [first] = change.before;
  assertDomain(first, `Merge ${change.id} must include before-state contacts.`);
  assertDomain(
    change.before.every(({ recordRef }) =>
      isSameContactSource(recordRef.source, first.recordRef.source),
    ) && isSameContactSource(change.after.recordRef.source, first.recordRef.source),
    `Merge ${change.id} must use one contact source.`,
  );
  const survivor = change.before.find(({ id }) => id === change.after.id);
  assertDomain(
    !survivor ||
      survivor.recordRef.sourceContactId === change.after.recordRef.sourceContactId,
    `Merge ${change.id} must preserve the survivor source contact id.`,
  );
}

export function createChangeSet(changeSet: ChangeSet): ChangeSet {
  assertDomain(changeSet.id.trim().length > 0, 'Change set id is required.');
  assertDomain(changeSet.snapshotId.trim().length > 0, 'Snapshot id is required.');
  assertDomain(
    !Number.isNaN(Date.parse(changeSet.createdAt)),
    'Change set createdAt must be a valid date-time.',
  );

  const changeIds = new Set<string>();
  for (const change of changeSet.changes) {
    assertDomain(!changeIds.has(change.id), `Duplicate proposed change id: ${change.id}.`);
    validateChange(change);
    changeIds.add(change.id);
  }

  return Object.freeze({ ...changeSet, changes: Object.freeze([...changeSet.changes]) });
}
