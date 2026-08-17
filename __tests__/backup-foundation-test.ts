import { CreateContactBackup, LoadContactBackup, type VerifiedBackupStore } from '@/application';
import {
  chunkContacts,
  validateBackupManifest,
  type BackupManifest,
  type CanonicalContact,
  type ContactSnapshot,
} from '@/domain';

function contact(id: string): CanonicalContact {
  const source = { kind: 'device' as const };
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

function snapshot(contacts: readonly CanonicalContact[]): ContactSnapshot {
  return {
    id: 'snapshot-1',
    schemaVersion: 1,
    source: { kind: 'device' },
    createdAt: '2026-08-17T00:00:00.000Z',
    contacts,
  };
}

function manifest(contactCount: number): BackupManifest {
  return {
    id: 'backup-1',
    schemaVersion: 1,
    snapshotId: 'snapshot-1',
    snapshotCreatedAt: '2026-08-17T00:00:00.000Z',
    source: { kind: 'device' },
    createdAt: '2026-08-17T00:00:00.000Z',
    contactCount,
    chunkContactLimit: 100,
    chunks: contactCount
      ? [
          {
            index: 0,
            fileName: 'chunk-000000.cfb',
            contactCount,
            encryptedSizeInBytes: 256,
            sha256: 'chunk-hash',
          },
        ]
      : [],
    artifact: { uri: 'file:///backup-1', sizeInBytes: 256, sha256: 'backup-hash' },
    encryption: { algorithm: 'AES-256-GCM', keyAlias: 'contactifier.backup.backup-1' },
  };
}

describe('backup foundation', () => {
  it('chunks 10,000 contacts without duplicating contact objects', () => {
    const contacts = Array.from({ length: 10_000 }, (_, index) => contact(`${index}`));
    const chunks = [...chunkContacts(contacts, 100)];

    expect(chunks).toHaveLength(100);
    expect(chunks.every((chunk) => chunk.length === 100)).toBe(true);
    expect(chunks.flat()).toHaveLength(10_000);
    expect(chunks[99][99]).toBe(contacts[9_999]);
  });

  it('rejects a manifest whose chunks do not account for every contact', () => {
    const invalid = { ...manifest(2), contactCount: 3 };
    expect(() => validateBackupManifest(invalid)).toThrow('does not match the manifest');
  });

  it('passes progress configuration to the verified store', async () => {
    const backupManifest = manifest(1);
    const createVerifiedBackup = jest.fn().mockResolvedValue(backupManifest);
    const store: VerifiedBackupStore = {
      createVerifiedBackup,
      async *readVerifiedBackup() {},
      listVerifiedBackups: async () => [backupManifest],
    };
    const onProgress = jest.fn();
    const input = snapshot([contact('one')]);

    await expect(
      new CreateContactBackup(store, 100).execute({ snapshot: input, onProgress }),
    ).resolves.toBe(backupManifest);
    expect(createVerifiedBackup).toHaveBeenCalledWith(input, {
      chunkContactLimit: 100,
      onProgress,
    });
  });

  it('loads verified chunks back into a validated snapshot', async () => {
    const contacts = [contact('one'), contact('two')];
    const store: VerifiedBackupStore = {
      createVerifiedBackup: jest.fn(),
      async *readVerifiedBackup() {
        yield contacts.slice(0, 1);
        yield contacts.slice(1);
      },
      listVerifiedBackups: async () => [],
    };

    const restored = await new LoadContactBackup(store).execute(manifest(2));

    expect(restored.contacts).toEqual(contacts);
    expect(restored.id).toBe('snapshot-1');
  });
});
