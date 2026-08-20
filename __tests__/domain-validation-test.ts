import {
  createChangeSet,
  createConfidenceScore,
  createContactDate,
  createContactSnapshot,
  DomainValidationError,
} from '@/domain';
import type { CanonicalContact, ContactSourceRef } from '@/domain';

const deviceSource: ContactSourceRef = { kind: 'device' };

function contact(id: string, source: ContactSourceRef = deviceSource): CanonicalContact {
  return {
    id,
    recordRef: { source, sourceContactId: id },
    displayName: `Contact ${id}`,
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

describe('domain validation', () => {
  it.each([0, 0.5, 1])('accepts confidence score %s', (value) => {
    expect(createConfidenceScore(value)).toBe(value);
  });

  it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid confidence score %s',
    (value) => {
      expect(() => createConfidenceScore(value)).toThrow(DomainValidationError);
    },
  );

  it('validates leap-day birthdays', () => {
    expect(createContactDate({ year: 2024, month: 2, day: 29 })).toEqual({
      year: 2024,
      month: 2,
      day: 29,
    });
    expect(() => createContactDate({ year: 2023, month: 2, day: 29 })).toThrow(
      DomainValidationError,
    );
  });

  it('allows a yearless leap-day birthday', () => {
    expect(createContactDate({ month: 2, day: 29 })).toEqual({ month: 2, day: 29 });
  });

  it('rejects duplicate contacts in a snapshot', () => {
    expect(() =>
      createContactSnapshot({
        id: 'snapshot-1',
        schemaVersion: 1,
        source: deviceSource,
        createdAt: '2026-08-15T00:00:00.000Z',
        contacts: [contact('one'), contact('one')],
      }),
    ).toThrow('duplicate contact id');
  });

  it('rejects contacts from another source', () => {
    expect(() =>
      createContactSnapshot({
        id: 'snapshot-1',
        schemaVersion: 1,
        source: deviceSource,
        createdAt: '2026-08-15T00:00:00.000Z',
        contacts: [contact('one', { kind: 'google', accountId: 'account-1' })],
      }),
    ).toThrow('different source');
  });

  it('rejects duplicate native source contact identities', () => {
    const first = contact('one');
    const second = {
      ...contact('two'),
      recordRef: { source: deviceSource, sourceContactId: first.recordRef.sourceContactId },
    };
    expect(() =>
      createContactSnapshot({
        id: 'snapshot-1',
        schemaVersion: 1,
        source: deviceSource,
        createdAt: '2026-08-15T00:00:00.000Z',
        contacts: [first, second],
      }),
    ).toThrow('duplicate source contact id');
  });

  it('rejects an update that changes the contact identity', () => {
    expect(() =>
      createChangeSet({
        id: 'changes-1',
        snapshotId: 'snapshot-1',
        createdAt: '2026-08-15T00:00:00.000Z',
        changes: [
          {
            id: 'update-1',
            kind: 'update',
            origin: 'rule',
            confidence: createConfidenceScore(1),
            reasons: ['Normalize phone number'],
            decision: 'pending',
            contactId: 'one',
            before: contact('one'),
            after: contact('two'),
          },
        ],
      }),
    ).toThrow('must preserve its contact id');
  });

  it('rejects a merge without two distinct contacts', () => {
    expect(() =>
      createChangeSet({
        id: 'changes-1',
        snapshotId: 'snapshot-1',
        createdAt: '2026-08-15T00:00:00.000Z',
        changes: [
          {
            id: 'merge-1',
            kind: 'merge',
            origin: 'rule',
            confidence: createConfidenceScore(0.8),
            reasons: ['Same verified phone number'],
            decision: 'pending',
            contactIds: ['one', 'one'],
            before: [contact('one'), contact('one')],
            after: contact('one'),
          },
        ],
      }),
    ).toThrow('at least two distinct contacts');
  });

  it('rejects a merge with duplicate before-state contacts', () => {
    expect(() =>
      createChangeSet({
        id: 'changes-1',
        snapshotId: 'snapshot-1',
        createdAt: '2026-08-15T00:00:00.000Z',
        changes: [
          {
            id: 'merge-1',
            kind: 'merge',
            origin: 'rule',
            confidence: createConfidenceScore(0.8),
            reasons: ['Same verified phone number'],
            decision: 'pending',
            contactIds: ['one', 'two'],
            before: [contact('one'), contact('one')],
            after: contact('one'),
          },
        ],
      }),
    ).toThrow('before-state for every contact');
  });
});
