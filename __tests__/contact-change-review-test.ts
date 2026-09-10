import {
  createBeautificationChangeSet,
  carryForwardChangeDecisions,
  createExactDuplicateChangeSet,
  resolveMergeConflict,
  setChangeDecision,
  summarizeChangeDecisions,
} from '@/application';
import {
  analyzeExactDuplicates,
  analyzeContactQuality,
  compareContactSnapshots,
  createContactSnapshot,
  createCleanupWorkflow,
  type CanonicalContact,
  type ContactSnapshot,
} from '@/domain';
import {
  createDemoContactSnapshot,
  createDemoPreviousContactSnapshot,
} from '@/features/contact-import/demo-contact-data';
import {
  contactReviewValues,
  createMergePreviewPresentation,
} from '@/features/contact-review/contact-change-presentation';
import { isWorkflowCompatibleWithActiveScan } from '@/features/contact-review/contact-review-workflow-selection';

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
  it('only resumes a device workflow for the currently scanned snapshot', () => {
    const workflow = createCleanupWorkflow({
      id: 'workflow-current-scan',
      source: { kind: 'device' },
      snapshotId: 'snapshot-review',
      backupId: 'backup-current',
      changeSet: proposed([
        contact('a', 'Ada', '212-555-0100'),
        contact('b', 'Ada B', '(212) 555-0100'),
      ]),
      createdAt: '2026-08-17T10:00:00.000Z',
    });

    expect(isWorkflowCompatibleWithActiveScan(workflow, {
      status: 'success',
      mode: 'device',
      snapshotId: 'snapshot-review',
    })).toBe(true);
    expect(isWorkflowCompatibleWithActiveScan(workflow, {
      status: 'success',
      mode: 'device',
      snapshotId: 'snapshot-new',
    })).toBe(false);
    expect(isWorkflowCompatibleWithActiveScan(workflow, {
      status: 'success',
      mode: 'demo',
      snapshotId: 'snapshot-new',
    })).toBe(true);
  });

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
    )).toEqual([2, 2]);

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

  it('does not transitively merge contacts without one shared exact identifier', () => {
    const result = proposed([
      contact('a', 'Ada One', '212-555-0100'),
      contact('b', 'Ada Two', '(212) 555-0100', 'ada@example.com'),
      contact('c', 'Ada Three', undefined, 'ADA@example.com'),
    ]);

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      id: 'merge:a:b',
      kind: 'merge',
      contactIds: ['a', 'b'],
      decision: 'pending',
      reasons: ['Same exact phone'],
    });
  });

  it('can merge three contacts when all share the same exact identifier', () => {
    const result = proposed([
      contact('a', 'Ada One', undefined, 'team@example.com'),
      contact('b', 'Ada Two', undefined, 'TEAM@example.com'),
      contact('c', 'Ada Three', undefined, 'team@example.com'),
    ]);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      kind: 'merge',
      contactIds: ['a', 'b', 'c'],
    });
  });

  it('bounds each merge proposal when many contacts share one value', () => {
    const result = proposed(
      Array.from({ length: 25 }, (_, index) =>
        contact(`shared-${index.toString().padStart(2, '0')}`, `Shared ${index}`, undefined, 'shared@example.com'),
      ),
    );
    expect(result.changes).toHaveLength(3);
    expect(
      result.changes.map((change) => (change.kind === 'merge' ? change.contactIds.length : 0)),
    ).toEqual([10, 10, 5]);
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

  it('presents the actual phone and email values for merge review', () => {
    const value = contact('a', 'Ada', '+1 (212) 555-0100', 'ada@example.com');

    expect(contactReviewValues(value)).toEqual([
      { id: 'phone:a:phone', kind: 'phone', label: 'Phone', value: '+1 (212) 555-0100' },
      { id: 'email:a:email', kind: 'email', label: 'Email', value: 'ada@example.com' },
    ]);
  });

  it('derives merge provenance from the same source and result contacts', () => {
    const primary = contact('a', 'Ada Personal', '+1 (212) 555-0100', 'ada@example.com');
    const secondary = contact('b', 'Ada Work', '+1 212 555 0100', 'work@example.com');
    const result = proposed([primary, secondary]).changes[0];
    if (result.kind !== 'merge') throw new Error('Expected merge fixture.');

    expect(createMergePreviewPresentation({ sources: result.before, result: result.after }).values)
      .toMatchObject([
        { kind: 'phone', status: 'duplicate-collapsed', sourceContactIds: ['a', 'b'] },
        { kind: 'email', value: 'ada@example.com', status: 'kept', sourceContactIds: ['a'] },
        { kind: 'email', value: 'work@example.com', status: 'added', sourceContactIds: ['b'] },
      ]);
  });

  it('persists an explicit source-name conflict choice in the proposed result', () => {
    const original = proposed([
      contact('a', 'Jordan Conflict', '646-555-0300'),
      contact('b', 'Taylor Conflict', '(646) 555-0300'),
    ]);
    const change = original.changes[0];
    if (change.kind !== 'merge') throw new Error('Expected merge fixture.');

    const resolved = resolveMergeConflict({
      changeSet: original,
      changeId: change.id,
      field: 'name',
      sourceContactId: 'b',
    });
    const resolvedChange = resolved.changes[0];
    expect(resolvedChange).toMatchObject({
      kind: 'merge',
      after: { displayName: 'Taylor Conflict', name: { givenName: 'Taylor Conflict' } },
      resolvedConflictFields: ['name'],
    });
    expect(original.changes[0]).not.toHaveProperty('resolvedConflictFields');
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

  it('carries rejected and later decisions only while source contacts are unchanged', () => {
    const original = proposed([
      contact('a', 'A', '212-555-0100'),
      contact('b', 'B', '212 555 0100'),
    ]);
    const rejected = setChangeDecision(original, original.changes[0].id, 'rejected');
    const history = createCleanupWorkflow({
      id: 'history',
      source: { kind: 'device' },
      snapshotId: rejected.snapshotId,
      backupId: 'backup-history',
      changeSet: rejected,
      createdAt: '2026-08-17T10:00:00.000Z',
    });

    expect(carryForwardChangeDecisions(proposed([
      contact('a', 'A', '212-555-0100'),
      contact('b', 'B', '212 555 0100'),
    ]), [history]).changes[0].decision).toBe('rejected');

    expect(carryForwardChangeDecisions(proposed([
      contact('a', 'A changed', '212-555-0100'),
      contact('b', 'B', '212 555 0100'),
    ]), [history]).changes[0].decision).toBe('pending');
  });

  it('returns accepted history to pending when the same suggestion still exists', () => {
    const original = proposed([
      contact('a', 'A', '212-555-0100'),
      contact('b', 'B', '212 555 0100'),
    ]);
    const accepted = setChangeDecision(original, original.changes[0].id, 'accepted');
    const history = createCleanupWorkflow({
      id: 'accepted-history',
      source: { kind: 'device' },
      snapshotId: accepted.snapshotId,
      backupId: 'backup-history',
      changeSet: accepted,
      createdAt: '2026-08-17T10:00:00.000Z',
    });

    expect(carryForwardChangeDecisions(original, [history]).changes[0].decision).toBe('pending');
  });
});
