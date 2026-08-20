import {
  applyAcceptedChangeSet,
  ChangeApplicationError,
  createChangeSet,
  createConfidenceScore,
  createContactSnapshot,
  DomainValidationError,
  rollbackAppliedChangeSet,
} from '@/domain';
import type {
  CanonicalContact,
  ChangeDecision,
  ChangeSet,
  ContactDeleteChange,
  ContactMergeChange,
  ContactSnapshot,
  ContactSourceRef,
  ContactUpdateChange,
  ProposedChange,
} from '@/domain';

const source: ContactSourceRef = { kind: 'device', containerId: 'local' };
const analyzedAt = '2026-08-17T08:00:00.000Z';
const rolledBackAt = '2026-08-17T09:00:00.000Z';

function contact(id: string, name = `Contact ${id}`): CanonicalContact {
  return {
    id,
    recordRef: { source, sourceContactId: id, revision: '1' },
    displayName: name,
    name: { givenName: name },
    nicknames: [],
    phoneNumbers: [],
    emailAddresses: [],
    postalAddresses: [],
    organizations: [],
    urls: [],
    birthdays: [],
    events: [],
    notes: [],
    groups: [],
    photos: [],
    extensions: {},
  };
}

function snapshot(contacts: readonly CanonicalContact[], id = 'snapshot-1'): ContactSnapshot {
  return createContactSnapshot({
    id,
    schemaVersion: 1,
    source,
    createdAt: analyzedAt,
    contacts,
  });
}

const baseChange = {
  origin: 'user' as const,
  confidence: createConfidenceScore(1),
  reasons: ['Regression fixture'],
  decision: 'accepted' as ChangeDecision,
};

function changes(changesToApply: readonly ProposedChange[], snapshotId = 'snapshot-1'): ChangeSet {
  return createChangeSet({
    id: 'changes-1',
    snapshotId,
    createdAt: analyzedAt,
    changes: changesToApply,
  });
}

function update(
  before: CanonicalContact,
  name: string,
  decision: ChangeDecision = 'accepted',
): ContactUpdateChange {
  return {
    ...baseChange,
    id: `update-${before.id}`,
    kind: 'update',
    decision,
    contactId: before.id,
    before,
    after: { ...before, displayName: name, name: { givenName: name } },
  };
}

function remove(
  before: CanonicalContact,
  decision: ChangeDecision = 'accepted',
): ContactDeleteChange {
  return {
    ...baseChange,
    id: `delete-${before.id}`,
    kind: 'delete',
    decision,
    contactId: before.id,
    before,
  };
}

function merge(
  before: readonly CanonicalContact[],
  after: CanonicalContact,
): ContactMergeChange {
  return {
    ...baseChange,
    id: `merge-${before.map(({ id }) => id).join('-')}`,
    kind: 'merge',
    contactIds: before.map(({ id }) => id),
    before,
    after,
  };
}

function names(result: ContactSnapshot): Record<string, string> {
  return Object.fromEntries(result.contacts.map(({ id, displayName }) => [id, displayName]));
}

describe('contact mutation regression contract', () => {
  const alpha = contact('alpha', 'Alpha');
  const beta = contact('beta', 'Beta');
  const gamma = contact('gamma', 'Gamma');

  it('updates a contact without changing other contacts', () => {
    const result = applyAcceptedChangeSet(
      snapshot([alpha, beta]),
      changes([update(alpha, 'Alpha Updated')]),
    );

    expect(names(result.snapshot)).toEqual({ alpha: 'Alpha Updated', beta: 'Beta' });
    expect(result.receipt.touchedContactIds).toEqual(['alpha']);
  });

  it('deletes only the accepted contact', () => {
    const result = applyAcceptedChangeSet(snapshot([alpha, beta]), changes([remove(alpha)]));
    expect(names(result.snapshot)).toEqual({ beta: 'Beta' });
  });

  it('merges contacts into one of the existing identities', () => {
    const merged = { ...alpha, displayName: 'Alpha & Beta', name: { givenName: 'Alpha & Beta' } };
    const result = applyAcceptedChangeSet(snapshot([alpha, beta, gamma]), changes([merge([alpha, beta], merged)]));

    expect(names(result.snapshot)).toEqual({ alpha: 'Alpha & Beta', gamma: 'Gamma' });
    expect(result.receipt.createdContactIds).toEqual([]);
    expect(result.receipt.touchedContactIds).toEqual(['alpha', 'beta']);
  });

  it('records a newly created merge identity for rollback', () => {
    const merged = contact('merged', 'Alpha & Beta');
    const result = applyAcceptedChangeSet(snapshot([alpha, beta]), changes([merge([alpha, beta], merged)]));

    expect(names(result.snapshot)).toEqual({ merged: 'Alpha & Beta' });
    expect(result.receipt.createdContactIds).toEqual(['merged']);
  });

  it.each(['rejected', 'skipped'] as const)('does not apply a %s change', (decision) => {
    const result = applyAcceptedChangeSet(snapshot([alpha]), changes([update(alpha, 'Changed', decision)]));
    expect(names(result.snapshot)).toEqual({ alpha: 'Alpha' });
    expect(result.receipt.touchedContactIds).toEqual([]);
  });

  it('rolls back update, delete, and merge while preserving later unrelated contacts', () => {
    const backup = snapshot([alpha, beta, gamma]);
    const merged = contact('merged', 'Beta & Gamma');
    const applied = applyAcceptedChangeSet(
      backup,
      changes([update(alpha, 'Alpha Updated'), merge([beta, gamma], merged)]),
    );
    const current = createContactSnapshot({
      ...applied.snapshot,
      id: 'current-after-apply',
      contacts: [...applied.snapshot.contacts, contact('later', 'Added Later')],
    });

    const restored = rollbackAppliedChangeSet(current, backup, applied.receipt, rolledBackAt);
    expect(names(restored)).toEqual({ alpha: 'Alpha', later: 'Added Later', beta: 'Beta', gamma: 'Gamma' });
    expect(restored.createdAt).toBe(rolledBackAt);
  });

  it('restores an accepted deletion from the backup', () => {
    const backup = snapshot([alpha, beta]);
    const applied = applyAcceptedChangeSet(backup, changes([remove(alpha)]));
    const restored = rollbackAppliedChangeSet(applied.snapshot, backup, applied.receipt, rolledBackAt);
    expect(names(restored)).toEqual({ beta: 'Beta', alpha: 'Alpha' });
  });

  it('refuses to roll back with a backup from another snapshot', () => {
    const backup = snapshot([alpha]);
    const applied = applyAcceptedChangeSet(backup, changes([remove(alpha)]));
    let error: unknown;
    try {
      rollbackAppliedChangeSet(
        applied.snapshot,
        snapshot([alpha], 'wrong-backup'),
        applied.receipt,
        rolledBackAt,
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ChangeApplicationError);
    expect((error as ChangeApplicationError).code).toBe('backup-mismatch');
  });

  const errorCases: readonly [string, () => void, string][] = [
    ['pending decision', () => applyAcceptedChangeSet(snapshot([alpha]), changes([update(alpha, 'New', 'pending')])), 'invalid-decision'],
    ['wrong snapshot', () => applyAcceptedChangeSet(snapshot([alpha]), changes([], 'another-snapshot')), 'snapshot-mismatch'],
    ['missing contact', () => applyAcceptedChangeSet(snapshot([]), changes([remove(alpha)])), 'contact-missing'],
    ['stale before-state', () => applyAcceptedChangeSet(snapshot([contact('alpha', 'Changed Elsewhere')]), changes([update(alpha, 'New')])), 'stale-contact'],
    ['overlapping changes', () => applyAcceptedChangeSet(snapshot([alpha]), changes([update(alpha, 'New'), remove(alpha)])), 'contact-overlap'],
    ['existing merge target', () => applyAcceptedChangeSet(snapshot([alpha, beta, gamma]), changes([merge([alpha, beta], gamma)])), 'target-collision'],
  ];

  it.each(errorCases)('rejects %s atomically', (_label, operation, code) => {
    expect.assertions(2);
    try {
      operation();
    } catch (error) {
      expect(error).toBeInstanceOf(ChangeApplicationError);
      expect((error as ChangeApplicationError).code).toBe(code);
    }
  });

  it('does not mutate the input snapshot when a later operation fails', () => {
    const original = snapshot([alpha, beta]);
    expect(() => applyAcceptedChangeSet(original, changes([update(alpha, 'New'), remove(contact('missing'))]))).toThrow();
    expect(names(original)).toEqual({ alpha: 'Alpha', beta: 'Beta' });
  });

  it('rejects malformed delete and identity-changing update fixtures', () => {
    expect(() => changes([{ ...remove(alpha), contactId: 'beta' }])).toThrow(DomainValidationError);
    expect(() => changes([{ ...update(alpha, 'New'), after: { ...contact('alpha'), recordRef: { source, sourceContactId: 'other' } } }])).toThrow(DomainValidationError);
    const foreign = {
      ...alpha,
      recordRef: {
        source: { kind: 'google' as const, accountId: 'g' },
        sourceContactId: 'alpha',
      },
    };
    expect(() => changes([{ ...update(alpha, 'New'), after: foreign }])).toThrow(
      DomainValidationError,
    );
  });
});
