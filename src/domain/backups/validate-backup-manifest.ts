import { assertDomain } from '../shared/invariant';
import type { BackupManifest } from './backup-manifest';

export function validateBackupManifest(manifest: BackupManifest): BackupManifest {
  assertDomain(manifest.id.trim().length > 0, 'Backup id is required.');
  assertDomain(manifest.contactCount >= 0, 'Backup contact count cannot be negative.');
  assertDomain(manifest.chunkContactLimit > 0, 'Backup chunk limit must be positive.');
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
  return manifest;
}
