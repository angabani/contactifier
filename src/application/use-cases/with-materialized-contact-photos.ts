import type { BackupManifest, CanonicalContact } from '@/domain';

import type { BackupPhotoMaterializer } from '../ports/backup-photo-materializer';

export class WithMaterializedContactPhotos {
  constructor(private readonly materializer: BackupPhotoMaterializer) {}

  async execute<T>(
    manifest: BackupManifest,
    contacts: readonly CanonicalContact[],
    consume: (contacts: readonly CanonicalContact[]) => Promise<T>,
  ): Promise<T> {
    const assetIds = contacts.flatMap((contact) =>
      contact.photos.map((photo, index) => photo.assetId ?? `${contact.id}:${index}`),
    );
    const lease = await this.materializer.materialize(manifest, assetIds);
    try {
      const uriByAssetId = new Map(lease.photos.map((photo) => [photo.assetId, photo.uri]));
      const materialized = contacts.map((contact) => ({
        ...contact,
        photos: contact.photos.map((photo, index) => {
          const assetId = photo.assetId ?? `${contact.id}:${index}`;
          const uri = uriByAssetId.get(assetId);
          if (!uri) throw new Error(`Photo asset ${assetId} was not materialized.`);
          return { ...photo, assetId, uri };
        }),
      }));
      return await consume(materialized);
    } finally {
      await lease.release();
    }
  }
}
