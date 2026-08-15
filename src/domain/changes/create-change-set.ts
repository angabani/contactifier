import { assertDomain } from '../shared/invariant';
import type { ChangeSet, ProposedChange } from './proposed-change';

function validateChange(change: ProposedChange): void {
  assertDomain(change.id.trim().length > 0, 'Proposed change id is required.');
  assertDomain(change.reasons.length > 0, `Change ${change.id} must include a reason.`);

  if (change.kind === 'update') {
    assertDomain(
      change.before.id === change.contactId && change.after.id === change.contactId,
      `Update ${change.id} must preserve its contact id.`,
    );
    return;
  }

  assertDomain(
    new Set(change.contactIds).size >= 2,
    `Merge ${change.id} must contain at least two distinct contacts.`,
  );
  assertDomain(
    change.before.length === change.contactIds.length &&
      change.before.every((contact) => change.contactIds.includes(contact.id)),
    `Merge ${change.id} must include a before-state for every contact.`,
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
