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

import {
  CleanupWorkflowConflictError,
  type CleanupWorkflowRepository,
  type CleanupWorkflowSummary,
} from '@/application';
import { validateCleanupWorkflow, type CleanupWorkflow, type CleanupWorkflowPhase } from '@/domain';
import { selectWorkflowRevisionDirectoriesToPrune } from '../workflow-revision-retention';

const ROOT_DIRECTORY = 'contactifier-workflows';
const KEYCHAIN_SERVICE = 'contactifier.workflow.keys';
const COMMIT_FILE = 'commit.json';
const CHUNK_SIZE_BYTES = 256 * 1024;

interface WorkflowChunkHeader {
  readonly index: number;
  readonly fileName: string;
  readonly encryptedSizeInBytes: number;
  readonly sha256: string;
}

interface WorkflowCommit extends CleanupWorkflowSummary {
  readonly schemaVersion: 1;
  readonly chunks: readonly WorkflowChunkHeader[];
  readonly payloadSha256: string;
}

export class CleanupWorkflowIntegrityError extends Error {
  constructor(message = 'The saved cleanup workflow failed its integrity check.') {
    super(message);
    this.name = 'CleanupWorkflowIntegrityError';
  }
}

export class CleanupWorkflowKeyUnavailableError extends Error {
  constructor() {
    super('The encryption key for this cleanup workflow is unavailable.');
    this.name = 'CleanupWorkflowKeyUnavailableError';
  }
}

function keyAlias(workflowId: string): string {
  return `contactifier.workflow.${workflowId}`;
}

function keyOptions(): SecureStore.SecureStoreOptions {
  return {
    keychainService: KEYCHAIN_SERVICE,
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };
}

function revisionDirectoryName(revision: number): string {
  return `r-${revision.toString().padStart(10, '0')}`;
}

function additionalData(workflowId: string, revision: number, index: number): Uint8Array {
  return new TextEncoder().encode(`contactifier-workflow-v1:${workflowId}:${revision}:${index}`);
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  return bytesToHex(
    new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, Uint8Array.from(bytes))),
  );
}

function validateCommit(value: WorkflowCommit): WorkflowCommit {
  if (
    value.schemaVersion !== 1 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.id) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !['applying', 'completed', 'failed', 'finalizing', 'preflighted', 'reviewing', 'rolled-back', 'rolling-back', 'verifying'].includes(value.phase) ||
    Number.isNaN(Date.parse(value.createdAt)) ||
    Number.isNaN(Date.parse(value.updatedAt)) ||
    !Array.isArray(value.chunks) ||
    value.chunks.length === 0 ||
    typeof value.payloadSha256 !== 'string'
  ) {
    throw new CleanupWorkflowIntegrityError('Cleanup workflow commit metadata is invalid.');
  }
  value.chunks.forEach((chunk, index) => {
    if (
      chunk.index !== index ||
      chunk.fileName !== `chunk-${index.toString().padStart(6, '0')}.cwf` ||
      !Number.isSafeInteger(chunk.encryptedSizeInBytes) ||
      chunk.encryptedSizeInBytes <= 0 ||
      !/^[a-f0-9]{64}$/.test(chunk.sha256)
    ) {
      throw new CleanupWorkflowIntegrityError('Cleanup workflow chunk metadata is invalid.');
    }
  });
  return value;
}

function summary(commit: Pick<WorkflowCommit, keyof CleanupWorkflowSummary>): CleanupWorkflowSummary {
  return {
    id: commit.id,
    revision: commit.revision,
    phase: commit.phase as CleanupWorkflowPhase,
    createdAt: commit.createdAt,
    updatedAt: commit.updatedAt,
  };
}

export class ExpoEncryptedCleanupWorkflowRepository implements CleanupWorkflowRepository {
  private mutationQueue: Promise<void> = Promise.resolve();

  load(workflowId: string): Promise<CleanupWorkflow | null> {
    return this.loadCurrent(workflowId);
  }

  discard(workflowId: string, expectedRevision: number | null): Promise<void> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(workflowId)) {
      return Promise.reject(new CleanupWorkflowIntegrityError('Cleanup workflow id is invalid.'));
    }
    const operation = this.mutationQueue.then(async () => {
      const directory = new Directory(Paths.document, ROOT_DIRECTORY, workflowId);
      const currentCommit = directory.exists ? await this.currentCommit(directory) : null;
      const actualRevision = currentCommit?.revision ?? null;
      if (
        (expectedRevision === null && currentCommit !== null) ||
        (expectedRevision !== null && actualRevision !== expectedRevision)
      ) {
        throw new CleanupWorkflowConflictError(workflowId, {
          expected: expectedRevision,
          actual: actualRevision,
        });
      }
      if (directory.exists) directory.delete();
      await SecureStore.deleteItemAsync(keyAlias(workflowId), keyOptions());
    });
    this.mutationQueue = operation.catch(() => undefined);
    return operation;
  }

  async listResumable(): Promise<readonly CleanupWorkflowSummary[]> {
    return (await this.listAll()).filter(({ phase }) => !['completed', 'rolled-back'].includes(phase));
  }

  async listAll(): Promise<readonly CleanupWorkflowSummary[]> {
    const root = new Directory(Paths.document, ROOT_DIRECTORY);
    if (!root.exists) return [];
    const summaries: CleanupWorkflowSummary[] = [];
    for (const entry of root.list()) {
      if (!(entry instanceof Directory) || entry.name.startsWith('.tmp-')) continue;
      const commit = await this.currentCommit(entry);
      if (commit) summaries.push(summary(commit));
    }
    return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  save(workflow: CleanupWorkflow, expectedRevision: number | null): Promise<void> {
    const operation = this.mutationQueue.then(() => this.saveExclusive(workflow, expectedRevision));
    this.mutationQueue = operation.catch(() => undefined);
    return operation;
  }

  private async saveExclusive(
    workflow: CleanupWorkflow,
    expectedRevision: number | null,
  ): Promise<void> {
    validateCleanupWorkflow(workflow);
    const existing = await this.loadCurrent(workflow.id);
    if (
      (expectedRevision === null && existing !== null) ||
      (expectedRevision !== null && existing?.revision !== expectedRevision) ||
      workflow.revision !== (expectedRevision === null ? 0 : expectedRevision + 1)
    ) {
      throw new CleanupWorkflowConflictError(workflow.id, {
        expected: expectedRevision,
        actual: existing?.revision ?? null,
        attempted: workflow.revision,
      });
    }
    if (!(await SecureStore.isAvailableAsync())) throw new CleanupWorkflowKeyUnavailableError();

    const root = new Directory(Paths.document, ROOT_DIRECTORY);
    root.create({ intermediates: true, idempotent: true });
    const workflowDirectory = new Directory(root, workflow.id);
    workflowDirectory.create({ intermediates: true, idempotent: true });
    const temporary = new Directory(workflowDirectory, `.tmp-${workflow.revision}-${randomUUID()}`);
    temporary.create();
    let createdKey = false;

    try {
      let keyHex = await SecureStore.getItemAsync(keyAlias(workflow.id), keyOptions());
      if (!keyHex) {
        if (expectedRevision !== null) throw new CleanupWorkflowKeyUnavailableError();
        const generatedKey = await AESEncryptionKey.generate();
        keyHex = await generatedKey.encoded('hex');
        await SecureStore.setItemAsync(keyAlias(workflow.id), keyHex, keyOptions());
        createdKey = true;
      }
      const encryptionKey = await AESEncryptionKey.import(keyHex, 'hex');
      const payload = new TextEncoder().encode(JSON.stringify(workflow));
      const chunks: WorkflowChunkHeader[] = [];
      for (let offset = 0, index = 0; offset < payload.length; offset += CHUNK_SIZE_BYTES, index += 1) {
        const plaintext = payload.slice(offset, offset + CHUNK_SIZE_BYTES);
        const sealed = await aesEncryptAsync(plaintext, encryptionKey, {
          additionalData: additionalData(workflow.id, workflow.revision, index),
        });
        const encrypted = await sealed.combined();
        if (typeof encrypted === 'string') throw new CleanupWorkflowIntegrityError();
        const fileName = `chunk-${index.toString().padStart(6, '0')}.cwf`;
        const file = new File(temporary, fileName);
        file.create();
        file.write(encrypted);
        chunks.push({
          index,
          fileName,
          encryptedSizeInBytes: encrypted.byteLength,
          sha256: await sha256Bytes(encrypted),
        });
      }
      const commit: WorkflowCommit = {
        schemaVersion: 1,
        ...summary(workflow),
        chunks,
        payloadSha256: await digestStringAsync(
          CryptoDigestAlgorithm.SHA256,
          chunks.map(({ index, sha256 }) => `${index}:${sha256}`).join('\n'),
        ),
      };
      const commitFile = new File(temporary, COMMIT_FILE);
      commitFile.create();
      commitFile.write(JSON.stringify(commit));
      await temporary.move(new Directory(workflowDirectory, revisionDirectoryName(workflow.revision)));
      try {
        this.pruneCommittedHistory(workflowDirectory);
      } catch {
        // The new revision is already committed. Cleanup is best-effort and retries next save.
      }
    } catch (error) {
      if (temporary.exists) temporary.delete();
      if (createdKey) await SecureStore.deleteItemAsync(keyAlias(workflow.id), keyOptions());
      throw error;
    }
  }

  private pruneCommittedHistory(workflowDirectory: Directory): void {
    const entries = workflowDirectory.list();
    const namesToPrune = new Set(
      selectWorkflowRevisionDirectoriesToPrune(entries.map(({ name }) => name)),
    );
    for (const entry of entries) {
      if (
        entry instanceof Directory &&
        (entry.name.startsWith('.tmp-') || namesToPrune.has(entry.name))
      ) {
        entry.delete();
      }
    }
  }

  private async loadCurrent(workflowId: string): Promise<CleanupWorkflow | null> {
    const directory = new Directory(Paths.document, ROOT_DIRECTORY, workflowId);
    if (!directory.exists) return null;
    const commit = await this.currentCommit(directory);
    if (!commit) return null;
    const keyHex = await SecureStore.getItemAsync(keyAlias(workflowId), keyOptions());
    if (!keyHex) throw new CleanupWorkflowKeyUnavailableError();
    const encryptionKey = await AESEncryptionKey.import(keyHex, 'hex');
    const revisionDirectory = new Directory(directory, revisionDirectoryName(commit.revision));
    const payloadSha256 = await digestStringAsync(
      CryptoDigestAlgorithm.SHA256,
      commit.chunks.map(({ index, sha256 }) => `${index}:${sha256}`).join('\n'),
    );
    if (payloadSha256 !== commit.payloadSha256) {
      throw new CleanupWorkflowIntegrityError('Workflow commit hash is invalid.');
    }
    const plaintextChunks: Uint8Array[] = [];
    for (const chunk of commit.chunks) {
      const file = new File(revisionDirectory, chunk.fileName);
      if (!file.exists) throw new CleanupWorkflowIntegrityError(`Workflow chunk ${chunk.index} is missing.`);
      const encrypted = await file.bytes();
      if (
        encrypted.byteLength !== chunk.encryptedSizeInBytes ||
        (await sha256Bytes(encrypted)) !== chunk.sha256
      ) {
        throw new CleanupWorkflowIntegrityError(`Workflow chunk ${chunk.index} is corrupt.`);
      }
      const decrypted = await aesDecryptAsync(AESSealedData.fromCombined(encrypted), encryptionKey, {
        additionalData: additionalData(workflowId, commit.revision, chunk.index),
        output: 'bytes',
      });
      if (typeof decrypted === 'string') throw new CleanupWorkflowIntegrityError();
      plaintextChunks.push(decrypted);
    }
    const combined = new Uint8Array(plaintextChunks.reduce((size, chunk) => size + chunk.length, 0));
    let offset = 0;
    for (const chunk of plaintextChunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      const workflow = validateCleanupWorkflow(
        JSON.parse(new TextDecoder().decode(combined)) as CleanupWorkflow,
      );
      if (workflow.id !== commit.id || workflow.revision !== commit.revision) {
        throw new CleanupWorkflowIntegrityError('Workflow payload does not match its commit.');
      }
      return workflow;
    } catch (error) {
      if (error instanceof CleanupWorkflowIntegrityError) throw error;
      throw new CleanupWorkflowIntegrityError('Workflow payload is invalid.');
    }
  }

  private async currentCommit(workflowDirectory: Directory): Promise<WorkflowCommit | null> {
    const commits: WorkflowCommit[] = [];
    for (const entry of workflowDirectory.list()) {
      if (!(entry instanceof Directory) || entry.name.startsWith('.tmp-')) continue;
      try {
        const file = new File(entry, COMMIT_FILE);
        if (!file.exists) continue;
        const commit = validateCommit(JSON.parse(await file.text()) as WorkflowCommit);
        if (entry.name === revisionDirectoryName(commit.revision)) commits.push(commit);
      } catch {
        // An incomplete revision has no authority; the last valid commit remains resumable.
      }
    }
    return commits.sort((left, right) => right.revision - left.revision)[0] ?? null;
  }
}
