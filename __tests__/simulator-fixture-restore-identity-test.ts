import { createContactRestorePlan, type CanonicalContact, type ContactSnapshot } from '@/domain';
import { reconcileSimulatorFixtureRestoreIdentity } from '@/features/developer/simulator-fixture-restore-identity';

const source = { kind: 'device' as const, accountId: 'ios-simulator' };

function contact(id: string, marker: string, name = 'Fixture'): CanonicalContact {
  return {
    id: `contact:${id}`,
    recordRef: { source, sourceContactId: id },
    displayName: name,
    name: { givenName: name },
    nicknames: [], phoneNumbers: [], emailAddresses: [], postalAddresses: [],
    organizations: [],
    urls: [{ id: `${id}:marker`, value: marker, origin: 'source' }],
    birthdays: [], events: [], notes: [], groups: [], photos: [], extensions: {},
  };
}

function snapshot(id: string, contacts: readonly CanonicalContact[]) {
  return {
    id,
    schemaVersion: 1 as const,
    source,
    createdAt: '2026-08-20T00:00:00.000Z',
    accessScope: 'all',
    contacts,
  } satisfies ContactSnapshot;
}

describe('simulator fixture restore identity', () => {
  it('reuses a recreated fixture and removes only additional exact copies', () => {
    const marker = 'contactifier://certification-fixture/set/fixture-a';
    const backupContact = contact('old-native-id', marker);
    const keeper = contact('new-native-id-a', marker);
    const duplicate = contact('new-native-id-b', marker);

    const reconciliation = reconcileSimulatorFixtureRestoreIdentity(
      [backupContact],
      [duplicate, keeper],
    );
    const plan = createContactRestorePlan(
      snapshot('backup', [backupContact]),
      snapshot('current', [duplicate, keeper]),
      reconciliation.sourceAliases,
    );

    expect(reconciliation.sourceAliases.get('old-native-id')).toBe('new-native-id-a');
    expect(reconciliation.redundantContacts.map((value) => value.recordRef.sourceContactId))
      .toEqual(['new-native-id-b']);
    expect(plan.recreateCount).toBe(0);
    expect(plan.unchangedCount).toBe(1);
  });

  it('reuses one edited marker match as an update without deleting it', () => {
    const marker = 'contactifier://certification-fixture/set/fixture-a';
    const backupContact = contact('old-native-id', marker, 'Original');
    const edited = contact('new-native-id', marker, 'Edited');

    const reconciliation = reconcileSimulatorFixtureRestoreIdentity([backupContact], [edited]);
    const plan = createContactRestorePlan(
      snapshot('backup', [backupContact]),
      snapshot('current', [edited]),
      reconciliation.sourceAliases,
    );

    expect(reconciliation.sourceAliases.get('old-native-id')).toBe('new-native-id');
    expect(reconciliation.redundantContacts).toHaveLength(0);
    expect(plan.recreateCount).toBe(0);
    expect(plan.updateCount).toBe(1);
  });
});
