import {
  createBeautificationChangeSet,
  createExactDuplicateChangeSet,
  setChangeDecision,
  summarizeChangeDecisions,
} from '@/application';
import {
  analyzeExactDuplicates,
  analyzeContactQuality,
  compareContactSnapshots,
  createContactSnapshot,
  type CanonicalContact,
  type ContactSnapshot,
} from '@/domain';
import {
  createDemoContactSnapshot,
  createDemoPreviousContactSnapshot,
} from '@/features/contact-import/demo-contact-data';

function contact(
  id: string,
  name: string,
  phone?: string,
  email?: string,
): CanonicalContact {
  const source = { kind: 'device' as const };
  return {
    id,
    recordRef: { source, sourceContactId: id },
    displayName: name,
    name: { givenName: name },
    nicknames: [],
    phoneNumbers: phone
      ? [{ id: `${id}:phone`, value: { raw: phone }, origin: 'source' }]
      : [],
    emailAddresses: email
      ? [{ id: `${id}:email`, value: email, origin: 'source' }]
      : [],
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

function snapshot(contacts: readonly CanonicalContact[]): ContactSnapshot {
  return createContactSnapshot({
    id: 'snapshot-review',
    schemaVersion: 1,
    source: { kind: 'device' },
    createdAt: '2026-08-17T10:00:00.000Z',
    contacts,
  });
}

function proposed(contacts: readonly CanonicalContact[]) {
  const current = snapshot(contacts);
  return createExactDuplicateChangeSet({
    snapshot: current,
    analysis: analyzeExactDuplicates(current),
    createdAt: current.createdAt,
  });
}

describe('contact change review', () => {
  it('provides a deterministic in-app demo with two duplicate clusters', () => {
    const demo = createDemoContactSnapshot();
    const analysis = analyzeExactDuplicates(demo);
    const result = createExactDuplicateChangeSet({
      snapshot: demo,
      analysis,
      createdAt: demo.createdAt,
    });

    expect(demo.contacts).toHaveLength(7);
    expect(analysis.matches).toHaveLength(3);
    expect(analysis.affectedContactIds).toHaveLength(5);
    expect(result.changes.map((change) => change.kind)).toEqual(['merge', 'merge']);
    expect(result.changes.map((change) =>
      change.kind === 'merge' ? change.contactIds.length : 0,
    )).toEqual([3, 2]);

    const beautification = createBeautificationChangeSet({
      snapshot: demo,
      duplicateAnalysis: analysis,
      qualityAnalysis: analyzeContactQuality(demo),
      createdAt: demo.createdAt,
    });
    expect(beautification.changes.map(({ kind }) => kind)).toEqual([
      'merge',
      'merge',
      'update',
      'delete',
    ]);

    expect(compareContactSnapshots(createDemoPreviousContactSnapshot(), demo)).toMatchObject({
      addedContactIds: ['demo-empty', 'demo-priya-work', 'demo-unique'],
      updatedContactIds: ['demo-arjun-phone'],
      deletedContactIds: ['demo-deleted'],
      unchangedContactIds: [
        'demo-arjun-bridge',
        'demo-arjun-email',
        'demo-priya-personal',
      ],
    });
  });

  it('turns a three-contact duplicate graph into one non-overlapping merge', () => {
    const result = proposed([
      contact('a', 'Ada One', '212-555-0100'),
      contact('b', 'Ada Two', '(212) 555-0100', 'ada@example.com'),
      contact('c', 'Ada Three', undefined, 'ADA@example.com'),
    ]);

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      id: 'merge:a:b:c',
      kind: 'merge',
      contactIds: ['a', 'b', 'c'],
      decision: 'pending',
      reasons: ['Same exact email', 'Same exact phone'],
    });
  });

  it('keeps distinct phone and email details in the proposed merged contact', () => {
    const result = proposed([
      contact('a', 'Ada', '212-555-0100', 'ada@example.com'),
      contact('b', 'Ada Work', '212 555 0100', 'work@example.com'),
    ]);
    const change = result.changes[0];
    expect(change.kind).toBe('merge');
    if (change.kind !== 'merge') throw new Error('Expected merge fixture.');

    expect(change.after.phoneNumbers).toHaveLength(1);
    expect(change.after.emailAddresses.map(({ value }) => value)).toEqual([
      'ada@example.com',
      'work@example.com',
    ]);
    expect(change.after.id).toBe('a');
  });

  it('creates separate proposals for disconnected duplicate groups', () => {
    const result = proposed([
      contact('a', 'A', '212-555-0100'),
      contact('b', 'B', '212 555 0100'),
      contact('c', 'C', '646-555-0100'),
      contact('d', 'D', '646 555 0100'),
    ]);
    expect(result.changes.map(({ id }) => id)).toEqual(['merge:a:b', 'merge:c:d']);
  });

  it.each(['accepted', 'rejected', 'skipped'] as const)(
    'records the %s review decision without mutating the original',
    (decision) => {
      const original = proposed([
        contact('a', 'A', '212-555-0100'),
        contact('b', 'B', '212 555 0100'),
      ]);
      const reviewed = setChangeDecision(original, 'merge:a:b', decision);

      expect(original.changes[0].decision).toBe('pending');
      expect(reviewed.changes[0].decision).toBe(decision);
      expect(summarizeChangeDecisions(reviewed)).toEqual({
        accepted: decision === 'accepted' ? 1 : 0,
        rejected: decision === 'rejected' ? 1 : 0,
        skipped: decision === 'skipped' ? 1 : 0,
        pending: 0,
        readyToApply: true,
      });
    },
  );

  it('is not ready while any decision is pending and rejects unknown change IDs', () => {
    const original = proposed([
      contact('a', 'A', '212-555-0100'),
      contact('b', 'B', '212 555 0100'),
    ]);
    expect(summarizeChangeDecisions(original).readyToApply).toBe(false);
    expect(() => setChangeDecision(original, 'missing', 'accepted')).toThrow('unknown change');
  });
});
