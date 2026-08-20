import {
  PhotoMaterializingContactWriter,
  WithMaterializedContactPhotos,
  type BackupPhotoMaterializer,
} from '@/application';
import type { BackupManifest, CanonicalContact } from '@/domain';

const manifest = {
  id: 'backup-1',
  schemaVersion: 1,
  snapshotId: 'snapshot-1',
  snapshotCreatedAt: '2026-08-20T00:00:00.000Z',
  source: { kind: 'device' },
  createdAt: '2026-08-20T00:00:00.000Z',
  contactCount: 1,
  chunkContactLimit: 100,
  chunks: [],
  photoAssets: [],
  artifact: { uri: 'file:///backup', sizeInBytes: 0, sha256: '0'.repeat(64) },
  encryption: { algorithm: 'AES-256-GCM', keyAlias: 'key' },
} satisfies BackupManifest;

const contact = {
  id: 'contact-1',
  recordRef: { source: { kind: 'device' }, sourceContactId: 'native-1' },
  displayName: 'Photo Contact',
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
  photos: [{ uri: 'file:///temporary-source', assetId: 'photo-asset-1' }],
  extensions: {},
} satisfies CanonicalContact;

describe('materialized contact photo scope', () => {
  it('replaces temporary URIs and releases the lease after consumption', async () => {
    const release = jest.fn().mockResolvedValue(undefined);
    const materializer: BackupPhotoMaterializer = {
      materialize: jest.fn().mockResolvedValue({
        photos: [{
          assetId: 'photo-asset-1',
          uri: 'file:///private-lease/photo-1',
          plaintextSha256: '1'.repeat(64),
        }],
        release,
      }),
    };

    await expect(new WithMaterializedContactPhotos(materializer).execute(
      manifest,
      [contact],
      async ([materialized]) => materialized?.photos[0]?.uri,
    )).resolves.toBe('file:///private-lease/photo-1');
    expect(materializer.materialize).toHaveBeenCalledWith(manifest, ['photo-asset-1']);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('scopes materialized photos around create and recreate native calls', async () => {
    const release = jest.fn().mockResolvedValue(undefined);
    const materializer: BackupPhotoMaterializer = {
      materialize: () => Promise.resolve({
        photos: [{ assetId: 'photo-asset-1', uri: 'file:///lease/photo', plaintextSha256: '1'.repeat(64) }],
        release,
      }),
    };
    const apply = jest.fn().mockResolvedValue({ operationId: 'create-1', sourceContactId: 'native-new' });
    const compensate = jest.fn().mockResolvedValue({
      operationId: 'delete-1',
      kind: 'recreate-deleted',
      restoredSourceContactId: 'native-restored',
    });
    const delegate = {
      apply,
      compensate,
      finalize: jest.fn(),
    };
    const writer = new PhotoMaterializingContactWriter(
      delegate,
      new WithMaterializedContactPhotos(materializer),
      manifest,
    );

    await writer.apply({
      id: 'create-1',
      changeId: 'change-1',
      kind: 'create',
      contact,
      reconciliationMarker: 'contactifier://write/snapshot/create-1',
    });
    expect(apply.mock.calls[0]?.[0].contact.photos[0].uri).toBe('file:///lease/photo');
    await writer.compensate(
      { kind: 'recreate-deleted', operationId: 'delete-1', contact },
      { operationId: 'delete-1', sourceContactId: 'native-old' },
    );
    expect(compensate.mock.calls[0]?.[0].contact.photos[0].uri).toBe('file:///lease/photo');
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('releases the lease when consumption fails or an asset is missing', async () => {
    const releaseAfterConsumerFailure = jest.fn().mockResolvedValue(undefined);
    const complete: BackupPhotoMaterializer = {
      materialize: () => Promise.resolve({
        photos: [{ assetId: 'photo-asset-1', uri: 'file:///photo', plaintextSha256: '1'.repeat(64) }],
        release: releaseAfterConsumerFailure,
      }),
    };
    await expect(new WithMaterializedContactPhotos(complete).execute(
      manifest,
      [contact],
      () => Promise.reject(new Error('Native write failed')),
    )).rejects.toThrow('Native write failed');
    expect(releaseAfterConsumerFailure).toHaveBeenCalledTimes(1);

    const releaseAfterMissingAsset = jest.fn().mockResolvedValue(undefined);
    const incomplete: BackupPhotoMaterializer = {
      materialize: () => Promise.resolve({ photos: [], release: releaseAfterMissingAsset }),
    };
    await expect(new WithMaterializedContactPhotos(incomplete).execute(
      manifest,
      [contact],
      () => Promise.resolve(),
    )).rejects.toThrow('was not materialized');
    expect(releaseAfterMissingAsset).toHaveBeenCalledTimes(1);
  });
});
