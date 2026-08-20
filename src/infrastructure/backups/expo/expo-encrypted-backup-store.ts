import {
  AESEncryptionKey,
  AESSealedData,
  CryptoDigestAlgorithm,
  aesDecryptAsync,
  aesEncryptAsync,
  digest,
  digestStringAsync,
  randomUUID,
} from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import type {
  BackupPhotoMaterializationLease,
  BackupPhotoMaterializer,
  CreateBackupOptions,
  MaterializedBackupPhoto,
  VerifiedBackupStore,
} from '@/application';
import {
  chunkContacts,
  validateBackupManifest,
  type BackupChunk,
  type BackupManifest,
  type BackupPhotoAsset,
  type CanonicalContact,
  type ContactSnapshot,
} from '@/domain';
import { isCurrentPhotoLease, photoLeaseName } from './photo-lease-retention';

const BACKUP_DIRECTORY_NAME = 'contactifier-backups';
const KEYCHAIN_SERVICE = 'contactifier.backup.keys';
const MANIFEST_FILE_NAME = 'manifest.json';
const PHOTO_LEASE_DIRECTORY_NAME = 'contactifier-photo-leases';
const PHOTO_LEASE_SESSION_ID = randomUUID();
let abandonedPhotoLeasesCleaned = false;

interface PlaintextBackupChunk {
  readonly schemaVersion: 1;
  readonly backupId: string;
  readonly index: number;
  readonly contacts: readonly CanonicalContact[];
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digestInput = Uint8Array.from(bytes);
  return bytesToHex(new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, digestInput)));
}

function chunkAdditionalData(backupId: string, index: number): Uint8Array {
  return new TextEncoder().encode(`contactifier-backup-v1:${backupId}:${index}`);
}

function photoAdditionalData(backupId: string, index: number): Uint8Array {
  return new TextEncoder().encode(`contactifier-backup-photo-v1:${backupId}:${index}`);
}

async function aggregateHash(
  chunks: readonly BackupChunk[],
  photoAssets?: readonly BackupPhotoAsset[],
): Promise<string> {
  if (photoAssets === undefined) {
    return digestStringAsync(
      CryptoDigestAlgorithm.SHA256,
      chunks
        .map(
          ({ index, fileName, contactCount, encryptedSizeInBytes, sha256 }) =>
            `${index}:${fileName}:${contactCount}:${encryptedSizeInBytes}:${sha256}`,
        )
        .join('\n'),
    );
  }
  return digestStringAsync(
    CryptoDigestAlgorithm.SHA256,
    [
      ...chunks.map(
        ({ index, fileName, contactCount, encryptedSizeInBytes, sha256 }) =>
          `chunk:${index}:${fileName}:${contactCount}:${encryptedSizeInBytes}:${sha256}`,
      ),
      ...photoAssets.map(
        ({ index, assetId, contactId, photoIndex, fileName, plaintextSizeInBytes, encryptedSizeInBytes, plaintextSha256, sha256 }) =>
          `photo:${index}:${assetId}:${contactId}:${photoIndex}:${fileName}:${plaintextSizeInBytes}:${encryptedSizeInBytes}:${plaintextSha256}:${sha256}`,
      ),
    ].join('\n'),
  );
}

function keyOptions(): SecureStore.SecureStoreOptions {
  return {
    keychainService: KEYCHAIN_SERVICE,
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };
}

export class BackupKeyUnavailableError extends Error {
  constructor() {
    super('The encryption key for this backup is unavailable.');
    this.name = 'BackupKeyUnavailableError';
  }
}

export class BackupIntegrityError extends Error {
  constructor(message = 'The encrypted backup failed its integrity check.') {
    super(message);
    this.name = 'BackupIntegrityError';
  }
}

export class ExpoEncryptedBackupStore implements VerifiedBackupStore, BackupPhotoMaterializer {
  cleanupAbandonedPhotoLeases(): number {
    const leaseRoot = new Directory(Paths.cache, PHOTO_LEASE_DIRECTORY_NAME);
    if (!leaseRoot.exists) {
      abandonedPhotoLeasesCleaned = true;
      return 0;
    }
    let removed = 0;
    for (const entry of leaseRoot.list()) {
      if (entry instanceof Directory && isCurrentPhotoLease(entry.name, PHOTO_LEASE_SESSION_ID)) {
        continue;
      }
      entry.delete();
      removed += 1;
    }
    abandonedPhotoLeasesCleaned = true;
    return removed;
  }

  async listVerifiedBackups(): Promise<readonly BackupManifest[]> {
    const backupRoot = new Directory(Paths.document, BACKUP_DIRECTORY_NAME);
    if (!backupRoot.exists) return [];

    const manifests: BackupManifest[] = [];
    for (const entry of backupRoot.list()) {
      if (!(entry instanceof Directory) || entry.name.startsWith('.tmp-')) continue;

      try {
        const manifestFile = new File(entry, MANIFEST_FILE_NAME);
        if (!manifestFile.exists) continue;
        const manifest = validateBackupManifest(
          JSON.parse(await manifestFile.text()) as BackupManifest,
        );
        if (
          manifest.artifact.uri.replace(/\/+$/, '') !== entry.uri.replace(/\/+$/, '')
        ) continue;
        manifests.push(manifest);
      } catch {
        // Incomplete or corrupt entries are not presented as restorable backups.
      }
    }

    return manifests.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async createVerifiedBackup(
    snapshot: ContactSnapshot,
    options: CreateBackupOptions,
  ): Promise<BackupManifest> {
    if (!(await SecureStore.isAvailableAsync())) {
      throw new BackupKeyUnavailableError();
    }

    const backupId = randomUUID();
    const keyAlias = `contactifier.backup.${backupId}`;
    const backupRoot = new Directory(Paths.document, BACKUP_DIRECTORY_NAME);
    backupRoot.create({ intermediates: true, idempotent: true });
    const temporaryDirectory = new Directory(backupRoot, `.tmp-${backupId}`);
    temporaryDirectory.create();
    const finalDirectory = new Directory(backupRoot, backupId);
    const encryptionKey = await AESEncryptionKey.generate();
    const keyHex = await encryptionKey.encoded('hex');
    await SecureStore.setItemAsync(keyAlias, keyHex, keyOptions());

    try {
      const chunks: BackupChunk[] = [];
      let completedContacts = 0;

      for (const contacts of chunkContacts(snapshot.contacts, options.chunkContactLimit)) {
        const index = chunks.length;
        const plaintext: PlaintextBackupChunk = {
          schemaVersion: 1,
          backupId,
          index,
          contacts,
        };
        const plaintextBytes = new TextEncoder().encode(JSON.stringify(plaintext));
        const sealed = await aesEncryptAsync(plaintextBytes, encryptionKey, {
          additionalData: chunkAdditionalData(backupId, index),
        });
        const encryptedBytes = await sealed.combined();
        if (typeof encryptedBytes === 'string') {
          throw new BackupIntegrityError('Unexpected encrypted backup encoding.');
        }

        const fileName = `chunk-${index.toString().padStart(6, '0')}.cfb`;
        const file = new File(temporaryDirectory, fileName);
        file.create();
        file.write(encryptedBytes);
        chunks.push({
          index,
          fileName,
          contactCount: contacts.length,
          encryptedSizeInBytes: encryptedBytes.byteLength,
          sha256: await sha256Bytes(encryptedBytes),
        });
        completedContacts += contacts.length;
        options.onProgress?.({
          phase: 'encrypting',
          completedContacts,
          totalContacts: snapshot.contacts.length,
        });
      }

      const photoAssets: BackupPhotoAsset[] = [];
      for (const contact of snapshot.contacts) {
        for (const [photoIndex, photo] of contact.photos.entries()) {
          const sourceFile = new File(photo.uri);
          if (!sourceFile.exists) {
            throw new BackupIntegrityError(`Photo ${photoIndex} for contact ${contact.id} is unavailable.`);
          }
          const plaintextBytes = await sourceFile.bytes();
          if (plaintextBytes.byteLength === 0) {
            throw new BackupIntegrityError(`Photo ${photoIndex} for contact ${contact.id} is empty.`);
          }
          const index = photoAssets.length;
          const sealed = await aesEncryptAsync(plaintextBytes, encryptionKey, {
            additionalData: photoAdditionalData(backupId, index),
          });
          const encryptedBytes = await sealed.combined();
          if (typeof encryptedBytes === 'string') {
            throw new BackupIntegrityError('Unexpected encrypted photo encoding.');
          }
          const fileName = `photo-${index.toString().padStart(6, '0')}.cfp`;
          const file = new File(temporaryDirectory, fileName);
          file.create();
          file.write(encryptedBytes);
          photoAssets.push({
            index,
            assetId: photo.assetId ?? `${contact.id}:${photoIndex}`,
            contactId: contact.id,
            photoIndex,
            fileName,
            plaintextSizeInBytes: plaintextBytes.byteLength,
            encryptedSizeInBytes: encryptedBytes.byteLength,
            plaintextSha256: await sha256Bytes(plaintextBytes),
            sha256: await sha256Bytes(encryptedBytes),
          });
        }
      }

      const manifest: BackupManifest = validateBackupManifest({
        id: backupId,
        schemaVersion: 1,
        snapshotId: snapshot.id,
        snapshotCreatedAt: snapshot.createdAt,
        snapshotSourceRevision: snapshot.sourceRevision,
        snapshotContentHash: snapshot.contentHash,
        snapshotAccessScope: snapshot.accessScope,
        source: snapshot.source,
        createdAt: new Date().toISOString(),
        contactCount: snapshot.contacts.length,
        chunkContactLimit: options.chunkContactLimit,
        chunks,
        photoAssets,
        artifact: {
          uri: finalDirectory.uri,
          sizeInBytes:
            chunks.reduce((sum, chunk) => sum + chunk.encryptedSizeInBytes, 0) +
            photoAssets.reduce((sum, asset) => sum + asset.encryptedSizeInBytes, 0),
          sha256: await aggregateHash(chunks, photoAssets),
        },
        encryption: { algorithm: 'AES-256-GCM', keyAlias },
      });

      await this.verifyDirectory(temporaryDirectory, manifest, encryptionKey, options);
      const manifestFile = new File(temporaryDirectory, MANIFEST_FILE_NAME);
      manifestFile.create();
      manifestFile.write(JSON.stringify(manifest));
      await temporaryDirectory.move(finalDirectory);
      return manifest;
    } catch (error) {
      if (temporaryDirectory.exists) temporaryDirectory.delete();
      await SecureStore.deleteItemAsync(keyAlias, keyOptions());
      throw error;
    }
  }

  async *readVerifiedBackup(
    manifest: BackupManifest,
  ): AsyncIterable<readonly CanonicalContact[]> {
    validateBackupManifest(manifest);
    const keyHex = await SecureStore.getItemAsync(manifest.encryption.keyAlias, keyOptions());
    if (!keyHex) throw new BackupKeyUnavailableError();

    const encryptionKey = await AESEncryptionKey.import(keyHex, 'hex');
    const directory = new Directory(manifest.artifact.uri);
    if (!directory.exists) throw new BackupIntegrityError('The backup directory is missing.');
    if ((await aggregateHash(manifest.chunks, manifest.photoAssets)) !== manifest.artifact.sha256) {
      throw new BackupIntegrityError('The backup manifest hash is invalid.');
    }

    for (const chunk of manifest.chunks) {
      yield await this.readChunk(directory, manifest.id, chunk, encryptionKey);
    }
  }

  async materialize(
    manifest: BackupManifest,
    assetIds: readonly string[],
  ): Promise<BackupPhotoMaterializationLease> {
    if (!abandonedPhotoLeasesCleaned) this.cleanupAbandonedPhotoLeases();
    validateBackupManifest(manifest);
    const requestedIds = new Set(assetIds);
    if (requestedIds.size !== assetIds.length) {
      throw new BackupIntegrityError('Photo materialization request contains duplicate asset ids.');
    }
    const assetsById = new Map(
      (manifest.photoAssets ?? []).map((asset) => [asset.assetId, asset]),
    );
    const assets = assetIds.map((assetId) => {
      const asset = assetsById.get(assetId);
      if (!asset) throw new BackupIntegrityError(`Backup photo asset ${assetId} is unavailable.`);
      return asset;
    });
    const keyHex = await SecureStore.getItemAsync(manifest.encryption.keyAlias, keyOptions());
    if (!keyHex) throw new BackupKeyUnavailableError();
    const encryptionKey = await AESEncryptionKey.import(keyHex, 'hex');
    const backupDirectory = new Directory(manifest.artifact.uri);
    if (!backupDirectory.exists) throw new BackupIntegrityError('The backup directory is missing.');
    if ((await aggregateHash(manifest.chunks, manifest.photoAssets)) !== manifest.artifact.sha256) {
      throw new BackupIntegrityError('The backup manifest hash is invalid.');
    }

    const leaseRoot = new Directory(Paths.cache, PHOTO_LEASE_DIRECTORY_NAME);
    leaseRoot.create({ intermediates: true, idempotent: true });
    const leaseDirectory = new Directory(
      leaseRoot,
      photoLeaseName(PHOTO_LEASE_SESSION_ID, manifest.id, randomUUID()),
    );
    leaseDirectory.create();
    try {
      const photos: MaterializedBackupPhoto[] = [];
      for (const asset of assets) {
        const bytes = await this.readPhoto(
          backupDirectory,
          manifest.id,
          asset,
          encryptionKey,
        );
        const file = new File(leaseDirectory, `photo-${asset.index.toString().padStart(6, '0')}`);
        file.create();
        file.write(bytes);
        photos.push({
          assetId: asset.assetId,
          uri: file.uri,
          plaintextSha256: asset.plaintextSha256,
        });
      }
      let released = false;
      return {
        photos: Object.freeze(photos),
        release: () => {
          if (!released && leaseDirectory.exists) leaseDirectory.delete();
          released = true;
          return Promise.resolve();
        },
      };
    } catch (error) {
      if (leaseDirectory.exists) leaseDirectory.delete();
      throw error;
    }
  }

  private async verifyDirectory(
    directory: Directory,
    manifest: BackupManifest,
    encryptionKey: Awaited<ReturnType<typeof AESEncryptionKey.generate>>,
    options: CreateBackupOptions,
  ): Promise<void> {
    let verifiedContacts = 0;
    for (const chunk of manifest.chunks) {
      const contacts = await this.readChunk(directory, manifest.id, chunk, encryptionKey);
      verifiedContacts += contacts.length;
      options.onProgress?.({
        phase: 'verifying',
        completedContacts: verifiedContacts,
        totalContacts: manifest.contactCount,
      });
    }
    for (const asset of manifest.photoAssets ?? []) {
      await this.readPhoto(directory, manifest.id, asset, encryptionKey);
    }
    if (verifiedContacts !== manifest.contactCount) throw new BackupIntegrityError();
  }

  private async readChunk(
    directory: Directory,
    backupId: string,
    chunk: BackupChunk,
    encryptionKey: Awaited<ReturnType<typeof AESEncryptionKey.generate>>,
  ): Promise<readonly CanonicalContact[]> {
    const file = new File(directory, chunk.fileName);
    if (!file.exists) throw new BackupIntegrityError(`Backup chunk ${chunk.index} is missing.`);
    const encryptedBytes = await file.bytes();
    if (
      encryptedBytes.byteLength !== chunk.encryptedSizeInBytes ||
      (await sha256Bytes(encryptedBytes)) !== chunk.sha256
    ) {
      throw new BackupIntegrityError(`Backup chunk ${chunk.index} is corrupt.`);
    }

    const sealed = AESSealedData.fromCombined(encryptedBytes);
    const decrypted = await aesDecryptAsync(sealed, encryptionKey, {
      additionalData: chunkAdditionalData(backupId, chunk.index),
      output: 'bytes',
    });
    if (typeof decrypted === 'string') throw new BackupIntegrityError();
    const payload = JSON.parse(new TextDecoder().decode(decrypted)) as PlaintextBackupChunk;
    if (
      payload.schemaVersion !== 1 ||
      payload.backupId !== backupId ||
      payload.index !== chunk.index ||
      payload.contacts.length !== chunk.contactCount
    ) {
      throw new BackupIntegrityError(`Backup chunk ${chunk.index} metadata is invalid.`);
    }
    return payload.contacts;
  }

  private async readPhoto(
    directory: Directory,
    backupId: string,
    asset: BackupPhotoAsset,
    encryptionKey: Awaited<ReturnType<typeof AESEncryptionKey.generate>>,
  ): Promise<Uint8Array> {
    const file = new File(directory, asset.fileName);
    if (!file.exists) throw new BackupIntegrityError(`Backup photo ${asset.index} is missing.`);
    const encryptedBytes = await file.bytes();
    if (
      encryptedBytes.byteLength !== asset.encryptedSizeInBytes ||
      (await sha256Bytes(encryptedBytes)) !== asset.sha256
    ) {
      throw new BackupIntegrityError(`Backup photo ${asset.index} is corrupt.`);
    }
    const decrypted = await aesDecryptAsync(AESSealedData.fromCombined(encryptedBytes), encryptionKey, {
      additionalData: photoAdditionalData(backupId, asset.index),
      output: 'bytes',
    });
    if (
      typeof decrypted === 'string' ||
      decrypted.byteLength !== asset.plaintextSizeInBytes ||
      (await sha256Bytes(decrypted)) !== asset.plaintextSha256
    ) {
      throw new BackupIntegrityError(`Backup photo ${asset.index} plaintext is corrupt.`);
    }
    return decrypted;
  }
}
