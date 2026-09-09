import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

import type { SmartModelArtifact, SmartModelCatalog, SmartModelFormat } from '@/application';

export const LOCAL_MODEL_INBOX_DIRECTORY = 'contactifier-model-inbox';
export const LOCAL_MODEL_FILE = 'local.model';
const MAX_LOCAL_MODEL_BYTES = 50 * 1024 * 1024;

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function modelIdentity(bytes: Uint8Array): { readonly version: string; readonly format: SmartModelFormat } {
  const value = JSON.parse(new TextDecoder().decode(bytes)) as {
    readonly version?: unknown;
    readonly trees?: unknown;
    readonly weights?: unknown;
  };
  if (typeof value.version !== 'string' || !value.version || value.version.length > 100) {
    throw new Error('Local smart model version is invalid.');
  }
  if (Array.isArray(value.trees)) return { version: value.version, format: 'contactifier-tree-ensemble-v1' };
  if (value.weights && typeof value.weights === 'object') return { version: value.version, format: 'contactifier-linear-v1' };
  throw new Error('Local smart model format is unsupported.');
}

/** Development-only catalog. Composition never constructs this outside an iOS simulator build. */
export class ExpoLocalSmartModelCatalog implements SmartModelCatalog {
  readonly inbox = new Directory(Paths.document, LOCAL_MODEL_INBOX_DIRECTORY);
  readonly file = new File(this.inbox, LOCAL_MODEL_FILE);

  async resolve(): Promise<SmartModelArtifact | undefined> {
    if (!this.file.exists) return undefined;
    if (this.file.size <= 0 || this.file.size > MAX_LOCAL_MODEL_BYTES) {
      throw new Error('Local smart model has an invalid size.');
    }
    const bytes = await this.file.bytes();
    const identity = modelIdentity(bytes);
    const sha256 = bytesToHex(new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes)));
    return Object.freeze({
      ...identity,
      url: this.file.uri,
      sha256,
      sizeInBytes: this.file.size,
    });
  }
}
