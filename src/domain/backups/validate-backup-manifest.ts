import { assertDomain } from '../shared/invariant';
import type { BackupManifest } from './backup-manifest';

export function validateBackupManifest(manifest: BackupManifest): BackupManifest {
  const sha256Pattern = /^[a-f0-9]{64}$/i;
  assertDomain(manifest.schemaVersion === 1, 'Unsupported backup schema version.');
  assertDomain(/^[A-Za-z0-9._-]+$/.test(manifest.id), 'Backup id is invalid.');
  assertDomain(manifest.snapshotId.trim().length > 0, 'Backup snapshot id is required.');
  assertDomain(
    !Number.isNaN(Date.parse(manifest.snapshotCreatedAt)),
    'Backup snapshot createdAt must be valid.',
  );
  assertDomain(!Number.isNaN(Date.parse(manifest.createdAt)), 'Backup createdAt must be valid.');
  assertDomain(
    manifest.source.kind === 'device' || manifest.source.kind === 'google',
    'Backup contact source is invalid.',
  );
  assertDomain(
    Number.isSafeInteger(manifest.contactCount) && manifest.contactCount >= 0,
    'Backup contact count must be a non-negative integer.',
  );
  assertDomain(
    Number.isSafeInteger(manifest.chunkContactLimit) && manifest.chunkContactLimit > 0,
    'Backup chunk limit must be a positive integer.',
  );
  assertDomain(manifest.artifact.uri.trim().length > 0, 'Backup artifact uri is required.');
  assertDomain(
    Number.isSafeInteger(manifest.artifact.sizeInBytes) && manifest.artifact.sizeInBytes >= 0,
    'Backup artifact size must be a non-negative integer.',
  );
  assertDomain(sha256Pattern.test(manifest.artifact.sha256), 'Backup artifact hash is invalid.');
  assertDomain(
    manifest.encryption.algorithm === 'AES-256-GCM',
    'Backup encryption algorithm is unsupported.',
  );
  assertDomain(manifest.encryption.keyAlias.trim().length > 0, 'Backup key alias is required.');
  assertDomain(
    manifest.chunks.every(
      (chunk) =>
        Number.isSafeInteger(chunk.index) &&
        Number.isSafeInteger(chunk.contactCount) &&
        chunk.contactCount > 0 &&
        Number.isSafeInteger(chunk.encryptedSizeInBytes) &&
        chunk.encryptedSizeInBytes > 0 &&
        /^chunk-\d{6}\.cfb$/.test(chunk.fileName) &&
        sha256Pattern.test(chunk.sha256),
    ),
    'Backup chunk metadata is invalid.',
  );
  assertDomain(
    manifest.chunks.reduce((sum, chunk) => sum + chunk.contactCount, 0) ===
      manifest.contactCount,
    'Backup chunk contact count does not match the manifest.',
  );
  assertDomain(
    manifest.chunks.every((chunk, index) => chunk.index === index),
    'Backup chunk indexes must be contiguous.',
  );
  assertDomain(
    new Set(manifest.chunks.map(({ fileName }) => fileName)).size === manifest.chunks.length,
    'Backup chunk filenames must be unique.',
  );
  const photoAssets = manifest.photoAssets ?? [];
  assertDomain(
    photoAssets.every(
      (asset) =>
        Number.isSafeInteger(asset.index) &&
        asset.index >= 0 &&
        asset.assetId.trim().length > 0 &&
        asset.contactId.trim().length > 0 &&
        Number.isSafeInteger(asset.photoIndex) &&
        asset.photoIndex >= 0 &&
        /^photo-\d{6}\.cfp$/.test(asset.fileName) &&
        Number.isSafeInteger(asset.plaintextSizeInBytes) &&
        asset.plaintextSizeInBytes > 0 &&
        Number.isSafeInteger(asset.encryptedSizeInBytes) &&
        asset.encryptedSizeInBytes > 0 &&
        sha256Pattern.test(asset.plaintextSha256) &&
        sha256Pattern.test(asset.sha256),
    ),
    'Backup photo metadata is invalid.',
  );
  assertDomain(
    photoAssets.every((asset, index) => asset.index === index),
    'Backup photo indexes must be contiguous.',
  );
  assertDomain(
    new Set(photoAssets.map(({ fileName }) => fileName)).size === photoAssets.length &&
      new Set(photoAssets.map(({ assetId }) => assetId)).size === photoAssets.length &&
      new Set(photoAssets.map(({ contactId, photoIndex }) => `${contactId}:${photoIndex}`)).size ===
        photoAssets.length,
    'Backup photo references must be unique.',
  );
  assertDomain(
    manifest.chunks.reduce((sum, chunk) => sum + chunk.encryptedSizeInBytes, 0) +
      photoAssets.reduce((sum, asset) => sum + asset.encryptedSizeInBytes, 0) ===
      manifest.artifact.sizeInBytes,
    'Backup artifact size does not match its encrypted contents.',
  );
  return manifest;
}
