import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import type { SmartModelArtifact, SmartModelArtifactStore } from '@/application';

const MODEL_DIRECTORY = 'contactifier-models';
const TEMPORARY_MODEL_FILE = 'duplicate-matcher.download';
const VERSION_KEY = 'contactifier.smart-model-version.v1';
const MAX_MODEL_SIZE_IN_BYTES = 50 * 1024 * 1024;
const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export class ExpoSmartModelArtifactStore implements SmartModelArtifactStore {
  private async activeMetadata(): Promise<{ readonly version: string; readonly format: SmartModelArtifact['format']; readonly fileName: string } | null> {
    if (!(await SecureStore.isAvailableAsync())) return null;
    const metadata = await SecureStore.getItemAsync(VERSION_KEY, secureOptions);
    if (!metadata) return null;
    try {
      const value = JSON.parse(metadata) as { readonly version?: unknown; readonly format?: unknown; readonly fileName?: unknown };
      const format = value.format ?? 'contactifier-linear-v1';
      if (typeof value.version !== 'string' || typeof value.fileName !== 'string'
        || (format !== 'contactifier-linear-v1' && format !== 'contactifier-tree-ensemble-v1')) return null;
      return new File(Paths.document, MODEL_DIRECTORY, value.fileName).exists
        ? { version: value.version, format, fileName: value.fileName }
        : null;
    } catch {
      return null;
    }
  }

  async activeVersion(): Promise<string | null> {
    return (await this.activeMetadata())?.version ?? null;
  }

  async activeArtifact(): Promise<Pick<SmartModelArtifact, 'version' | 'format'> | null> {
    const metadata = await this.activeMetadata();
    return metadata ? { version: metadata.version, format: metadata.format } : null;
  }

  async loadActiveBytes(): Promise<Uint8Array | null> {
    const metadata = await this.activeMetadata();
    if (!metadata) return null;
    return new File(Paths.document, MODEL_DIRECTORY, metadata.fileName).bytes();
  }

  async install(
    artifact: SmartModelArtifact,
    onProgress?: (update: { readonly phase: 'downloading' | 'verifying'; readonly progress?: number }) => void,
  ): Promise<void> {
    const directory = new Directory(Paths.document, MODEL_DIRECTORY);
    directory.create({ intermediates: true, idempotent: true });
    const temporary = new File(directory, TEMPORARY_MODEL_FILE);
    if (temporary.exists) temporary.delete();

    try {
      onProgress?.({ phase: 'downloading', progress: 0 });
      let downloaded: File;
      if (artifact.url.startsWith('file://')) {
        new File(artifact.url).copy(temporary, { overwrite: true });
        // Expo File instances cache metadata, so construct a fresh handle after copying.
        downloaded = new File(temporary.uri);
      } else {
        downloaded = await File.downloadFileAsync(artifact.url, temporary, { idempotent: true });
      }
      if (downloaded.size > MAX_MODEL_SIZE_IN_BYTES) {
        throw new Error('Downloaded smart matching model exceeds the safe size limit.');
      }
      if (artifact.sizeInBytes !== undefined && downloaded.size !== artifact.sizeInBytes) {
        throw new Error('Downloaded smart matching model has an unexpected size.');
      }
      onProgress?.({ phase: 'verifying' });
      const actualHash = bytesToHex(new Uint8Array(
        await digest(CryptoDigestAlgorithm.SHA256, await downloaded.bytes()),
      ));
      if (actualHash.toLowerCase() !== artifact.sha256.toLowerCase()) {
        throw new Error('Downloaded smart matching model failed integrity verification.');
      }

      const fileName = `duplicate-matcher-${artifact.sha256.toLowerCase()}.model`;
      const finalFile = new File(directory, fileName);
      await downloaded.move(finalFile, { overwrite: true });
      await SecureStore.setItemAsync(
        VERSION_KEY,
        JSON.stringify({ version: artifact.version, format: artifact.format, fileName }),
        secureOptions,
      );
      for (const entry of directory.list()) {
        if (entry instanceof File && entry.name !== fileName) entry.delete();
      }
    } catch (error) {
      if (temporary.exists) temporary.delete();
      throw error;
    }
  }

  async remove(): Promise<void> {
    const directory = new Directory(Paths.document, MODEL_DIRECTORY);
    if (directory.exists) directory.delete();
    if (await SecureStore.isAvailableAsync()) {
      await SecureStore.deleteItemAsync(VERSION_KEY, secureOptions);
    }
  }
}
