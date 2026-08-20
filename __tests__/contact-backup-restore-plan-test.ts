import { prepareContactBackupRestore } from '@/application';
import { createContactSnapshot, type BackupManifest, type CanonicalContact } from '@/domain';

const source = { kind: 'device' as const };
const at = '2026-08-20T14:00:00.000Z';

function contact(id: string, name: string): CanonicalContact {
  return {
    id, recordRef: { source, sourceContactId: `native-${id}` }, displayName: name,
    name: { givenName: name }, nicknames: [], phoneNumbers: [], emailAddresses: [],
    postalAddresses: [], organizations: [], urls: [], birthdays: [], events: [], notes: [],
    groups: [], photos: [], extensions: {},
  };
}

const originalA = contact('a', 'Original A');
const originalB = contact('b', 'Original B');
const backupSnapshot = createContactSnapshot({
  id: 'backup-snapshot', schemaVersion: 1, source, accessScope: 'all', createdAt: at,
  contacts: [originalA, originalB],
});
const manifest = {
  id: 'backup-1', snapshotId: backupSnapshot.id, source,
} as BackupManifest;

describe('contact backup restore plan', () => {
  it('updates changed contacts, recreates missing contacts, and prepares rollback for both', () => {
    const current = createContactSnapshot({
      id: 'current', schemaVersion: 1, source, accessScope: 'all', createdAt: at,
      contacts: [contact('a', 'Merged A')],
    });
    const prepared = prepareContactBackupRestore({
      manifest, backupSnapshot, currentSnapshot: current, plannedAt: at,
    });
    expect(prepared.writePlan).toMatchObject({ createCount: 1, updateCount: 1, deleteCount: 0 });
    expect(prepared.writePlan.operations.map(({ kind }) => kind)).toEqual(['update', 'create']);
    expect(prepared.writePlan.compensations.map(({ kind }) => kind)).toEqual([
      'delete-created', 'restore-update',
    ]);
  });

  it('does not delete contacts added after the selected backup', () => {
    const current = createContactSnapshot({
      id: 'current', schemaVersion: 1, source, accessScope: 'all', createdAt: at,
      contacts: [originalA, originalB, contact('new', 'Added Later')],
    });
    expect(() => prepareContactBackupRestore({
      manifest, backupSnapshot, currentSnapshot: current, plannedAt: at,
    })).toThrow('already matches');
  });

  it('deletes only explicitly verified Contactifier-derived contacts', () => {
    const derived = contact('merge-result', 'Merged Result');
    const current = createContactSnapshot({
      id: 'current', schemaVersion: 1, source, accessScope: 'all', createdAt: at,
      contacts: [originalA, originalB, derived, contact('new', 'Added Later')],
    });
    const prepared = prepareContactBackupRestore({
      manifest, backupSnapshot, currentSnapshot: current,
      derivedContactsToDelete: [derived], plannedAt: at,
    });
    expect(prepared.writePlan).toMatchObject({ createCount: 0, updateCount: 0, deleteCount: 1 });
    expect(prepared.writePlan.operations[0]).toMatchObject({
      kind: 'delete', sourceContactId: 'native-merge-result',
    });
    expect(prepared.writePlan.compensations[0]).toMatchObject({ kind: 'recreate-deleted' });
  });

  it('reuses a recreated contact alias instead of creating it again', () => {
    const recreatedB = {
      ...originalB,
      recordRef: { source, sourceContactId: 'native-recreated-b' },
    };
    const duplicateB = {
      ...originalB,
      id: 'duplicate-b',
      recordRef: { source, sourceContactId: 'native-duplicate-b' },
    };
    const current = createContactSnapshot({
      id: 'current', schemaVersion: 1, source, accessScope: 'all', createdAt: at,
      contacts: [originalA, recreatedB, duplicateB],
    });
    const prepared = prepareContactBackupRestore({
      manifest, backupSnapshot, currentSnapshot: current,
      sourceAliases: new Map([['native-b', 'native-recreated-b']]),
      derivedContactsToDelete: [duplicateB], plannedAt: at,
    });
    expect(prepared.writePlan).toMatchObject({ createCount: 0, updateCount: 0, deleteCount: 1 });
  });
});
