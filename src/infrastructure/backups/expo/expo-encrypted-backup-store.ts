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
  CreateBackupOptions,
  VerifiedBackupStore,
} from '@/application';
import {
  chunkContacts,
  validateBackupManifest,
  type BackupChunk,
  type BackupManifest,
  type CanonicalContact,
  type ContactSnapshot,
} from '@/domain';

const BACKUP_DIRECTORY_NAME = 'contactifier-backups';
const KEYCHAIN_SERVICE = 'contactifier.backup.keys';
const MANIFEST_FILE_NAME = 'manifest.json';

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

function additionalData(backupId: string, index: number): Uint8Array {
  return new TextEncoder().encode(`contactifier-backup-v1:${backupId}:${index}`);
}

async function aggregateHash(chunks: readonly BackupChunk[]): Promise<string> {
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

export class ExpoEncryptedBackupStore implements VerifiedBackupStore {
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
          additionalData: additionalData(backupId, index),
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
        artifact: {
          uri: finalDirectory.uri,
          sizeInBytes: chunks.reduce((sum, chunk) => sum + chunk.encryptedSizeInBytes, 0),
          sha256: await aggregateHash(chunks),
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
    if ((await aggregateHash(manifest.chunks)) !== manifest.artifact.sha256) {
      throw new BackupIntegrityError('The backup manifest hash is invalid.');
    }

    for (const chunk of manifest.chunks) {
      yield await this.readChunk(directory, manifest.id, chunk, encryptionKey);
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
      additionalData: additionalData(backupId, chunk.index),
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
}
