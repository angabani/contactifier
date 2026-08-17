import { createBeautificationChangeSet } from '@/application';
import {
  analyzeContactQuality,
  analyzeExactDuplicates,
  createContactSnapshot,
  type CanonicalContact,
  type ContactSnapshot,
} from '@/domain';

const source = { kind: 'device' as const };

function contact(id: string, overrides: Partial<CanonicalContact> = {}): CanonicalContact {
  return {
    id,
    recordRef: { source, sourceContactId: id },
    displayName: id,
    name: { givenName: id },
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
    ...overrides,
  };
}

function snapshot(contacts: readonly CanonicalContact[]): ContactSnapshot {
  return createContactSnapshot({
    id: 'quality-snapshot',
    schemaVersion: 1,
    source,
    createdAt: '2026-08-17T14:00:00.000Z',
    contacts,
  });
}

describe('contact quality analysis', () => {
  it('proposes a safe update for repeated fields and surrounding whitespace', () => {
    const current = snapshot([
      contact('ada', {
        displayName: '  Ada Lovelace  ',
        name: { givenName: ' Ada ', familyName: ' Lovelace ' },
        phoneNumbers: [
          { id: 'p1', value: { raw: '+1 212 555 0100' }, origin: 'source' },
          { id: 'p2', value: { raw: '+1-212-555-0100' }, origin: 'source' },
        ],
        emailAddresses: [
          { id: 'e1', value: ' Ada@example.com ', origin: 'source' },
          { id: 'e2', value: 'ada@EXAMPLE.com', origin: 'source' },
        ],
      }),
    ]);
    const finding = analyzeContactQuality(current).findings[0];

    expect(finding.suggestedAction).toBe('update');
    expect(finding.issueKinds).toEqual(['duplicate-email', 'duplicate-phone', 'whitespace']);
    expect(finding.after).toMatchObject({
      displayName: 'Ada Lovelace',
      name: { givenName: 'Ada', familyName: 'Lovelace' },
    });
    expect(finding.after?.phoneNumbers).toHaveLength(1);
    expect(finding.after?.emailAddresses).toHaveLength(1);
    expect(finding.after?.emailAddresses[0].value).toBe('Ada@example.com');
  });

  it('flags a missing name without inventing an update', () => {
    const current = snapshot([
      contact('phone-only', {
        displayName: '',
        name: undefined,
        phoneNumbers: [{ id: 'p1', value: { raw: '2125550100' }, origin: 'source' }],
      }),
    ]);
    expect(analyzeContactQuality(current).findings[0]).toMatchObject({
      issueKinds: ['missing-name'],
      suggestedAction: 'none',
      after: undefined,
    });
  });

  it('proposes deletion only when every useful field is empty', () => {
    const empty = contact('empty', { displayName: '', name: undefined });
    const withNote = contact('with-note', {
      displayName: '',
      name: undefined,
      notes: [{ id: 'n1', value: 'Keep me', origin: 'source' }],
    });
    const result = analyzeContactQuality(snapshot([empty, withNote]));

    expect(result.findings.find(({ contactId }) => contactId === 'empty')?.suggestedAction).toBe(
      'delete',
    );
    expect(
      result.findings.find(({ contactId }) => contactId === 'with-note')?.suggestedAction,
    ).toBe('none');
  });

  it('does not create overlapping quality proposals for contacts already being merged', () => {
    const current = snapshot([
      contact('a', {
        phoneNumbers: [
          { id: 'a1', value: { raw: '2125550100' }, origin: 'source' },
          { id: 'a2', value: { raw: '212-555-0100' }, origin: 'source' },
        ],
      }),
      contact('b', {
        phoneNumbers: [{ id: 'b1', value: { raw: '(212) 555-0100' }, origin: 'source' }],
      }),
    ]);
    const duplicateAnalysis = analyzeExactDuplicates(current);
    const result = createBeautificationChangeSet({
      snapshot: current,
      duplicateAnalysis,
      qualityAnalysis: analyzeContactQuality(current),
      createdAt: current.createdAt,
    });

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].kind).toBe('merge');
    if (result.changes[0].kind !== 'merge') throw new Error('Expected merge fixture.');
    expect(result.changes[0].after.phoneNumbers).toHaveLength(1);
  });
});
