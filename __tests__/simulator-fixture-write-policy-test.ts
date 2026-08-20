import { assertSimulatorFixtureWritePlan } from '@/features/developer/simulator-fixture-write-policy';
import type { CanonicalContact, ContactWritePlan } from '@/domain';

function contact(id: string, owned = true): CanonicalContact {
  return {
    id,
    recordRef: { source: { kind: 'device' }, sourceContactId: id },
    displayName: owned ? '[Contactifier Test] Fixture' : 'Real Person',
    name: { givenName: owned ? '[Contactifier Test] Fixture' : 'Real Person' },
    nicknames: [], phoneNumbers: [], emailAddresses: [], postalAddresses: [], organizations: [],
    urls: owned ? [{ id: `${id}:url`, value: `contactifier://certification-fixture/set/${id}`, origin: 'source' }] : [],
    birthdays: [], events: [], notes: [], groups: [], photos: [], extensions: {},
  };
}

function plan(before: CanonicalContact, after: CanonicalContact): ContactWritePlan {
  return {
    mode: 'dry-run', changeSetId: 'changes', analyzedSnapshotId: 'analyzed', freshSnapshotId: 'fresh',
    backupId: 'backup', plannedAt: '2026-08-20T00:00:00.000Z',
    operations: [{ id: 'update', changeId: 'merge', kind: 'update', sourceContactId: before.recordRef.sourceContactId, before, after }],
    compensations: [{ kind: 'restore-update', operationId: 'update', contact: before }],
    createCount: 0, updateCount: 1, deleteCount: 0,
  };
}

describe('simulator fixture write policy', () => {
  it('accepts a plan whose before and after states retain fixture ownership', () => {
    expect(() => assertSimulatorFixtureWritePlan(plan(contact('a'), contact('a')))).not.toThrow();
  });

  it.each([
    ['unowned before-state', contact('real', false), contact('real')],
    ['unowned result', contact('fixture'), contact('fixture', false)],
  ])('rejects %s before any native writer is called', (_label, before, after) => {
    expect(() => assertSimulatorFixtureWritePlan(plan(before, after))).toThrow('not owned');
  });

  it('rejects an empty plan', () => {
    expect(() => assertSimulatorFixtureWritePlan({ ...plan(contact('a'), contact('a')), operations: [], compensations: [], updateCount: 0 })).toThrow('no operations');
  });
});
