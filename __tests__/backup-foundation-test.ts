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
            sha256: '1'.repeat(64),
          },
        ]
      : [],
    artifact: {
      uri: 'file:///backup-1',
      sizeInBytes: contactCount ? 256 : 0,
      sha256: '2'.repeat(64),
    },
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

  it('rejects unsafe chunk paths and malformed integrity hashes', () => {
    const valid = manifest(1);
    expect(() =>
      validateBackupManifest({
        ...valid,
        chunks: [{ ...valid.chunks[0], fileName: '../contacts.json' }],
      }),
    ).toThrow('chunk metadata');
    expect(() =>
      validateBackupManifest({
        ...valid,
        artifact: { ...valid.artifact, sha256: 'not-a-sha256' },
      }),
    ).toThrow('artifact hash');
  });

  it('validates encrypted photo assets as part of the artifact size and identity map', () => {
    const valid = manifest(1);
    const photoAsset = {
      index: 0,
      assetId: 'one:0',
      contactId: 'one',
      photoIndex: 0,
      fileName: 'photo-000000.cfp',
      plaintextSizeInBytes: 128,
      encryptedSizeInBytes: 160,
      plaintextSha256: '3'.repeat(64),
      sha256: '4'.repeat(64),
    };
    expect(() => validateBackupManifest({
      ...valid,
      photoAssets: [photoAsset],
      artifact: { ...valid.artifact, sizeInBytes: 416 },
    })).not.toThrow();
    expect(() => validateBackupManifest({
      ...valid,
      photoAssets: [photoAsset, { ...photoAsset, index: 1, fileName: 'photo-000001.cfp' }],
      artifact: { ...valid.artifact, sizeInBytes: 576 },
    })).toThrow('references must be unique');
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
