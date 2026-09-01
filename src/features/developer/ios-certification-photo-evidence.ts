import type { CleanupWorkflow } from '@/domain';
import { isSimulatorFixtureWritePlanOwned } from './simulator-fixture-write-policy';

export interface IosPhotoRoundTripEvidence {
  readonly schemaVersion: 1;
  readonly scenario: 'photo-round-trip';
  readonly workflowId: string;
  readonly workflowRevision: number;
  readonly backupId: string;
  readonly operationId: string;
  readonly assetId: string;
  readonly nativeContactId: string;
  readonly expectedSha256: string;
  readonly actualSha256: string;
  readonly observedAt: string;
}

const SHA256 = /^[a-f0-9]{64}$/;

export function createIosPhotoRoundTripEvidence(input: {
  readonly workflow: CleanupWorkflow;
  readonly operationId: string;
  readonly assetId: string;
  readonly nativeContactId: string;
  readonly expectedSha256: string;
  readonly actualSha256: string;
  readonly observedAt: string;
}): IosPhotoRoundTripEvidence {
  const { workflow } = input;
  if (
    workflow.phase !== 'completed' || !workflow.writePlan ||
    !isSimulatorFixtureWritePlanOwned(workflow.writePlan) ||
    !isRestorationWorkflow(workflow)
  ) throw new Error('Photo evidence requires a completed owned restoration workflow.');
  const operation = workflow.writePlan.operations.find(({ id }) => id === input.operationId);
  if (operation?.kind !== 'create') throw new Error('Photo evidence requires a completed create operation.');
  if (!operation.contact.photos.some((photo, index) =>
    (photo.assetId ?? `${operation.contact.id}:${index}`) === input.assetId)) {
    throw new Error('The backup photo asset is not part of the certified operation.');
  }
  const receipt = workflow.journal.find(({ operationId, outcome, receipt }) =>
    operationId === input.operationId && outcome === 'applied' && receipt)?.receipt;
  if (receipt?.sourceContactId !== input.nativeContactId) {
    throw new Error('The native contact is not bound to the operation receipt.');
  }
  const expectedSha256 = input.expectedSha256.toLowerCase();
  const actualSha256 = input.actualSha256.toLowerCase();
  if (!SHA256.test(expectedSha256) || !SHA256.test(actualSha256)) {
    throw new Error('Photo evidence requires valid SHA-256 hashes.');
  }
  if (expectedSha256 !== actualSha256) throw new Error('The native photo bytes differ from the authenticated backup.');
  if (Number.isNaN(Date.parse(input.observedAt))) throw new Error('Photo evidence timestamp is invalid.');
  return Object.freeze({
    schemaVersion: 1,
    scenario: 'photo-round-trip',
    workflowId: workflow.id,
    workflowRevision: workflow.revision,
    backupId: workflow.backupId,
    operationId: input.operationId,
    assetId: input.assetId,
    nativeContactId: input.nativeContactId,
    expectedSha256,
    actualSha256,
    observedAt: input.observedAt,
  });
}

export function isIosPhotoRoundTripEvidence(value: unknown): value is IosPhotoRoundTripEvidence {
  if (!value || typeof value !== 'object') return false;
  const evidence = value as Partial<IosPhotoRoundTripEvidence>;
  return evidence.schemaVersion === 1 && evidence.scenario === 'photo-round-trip' &&
    typeof evidence.workflowId === 'string' && evidence.workflowId.length > 0 &&
    Number.isInteger(evidence.workflowRevision) &&
    typeof evidence.backupId === 'string' && evidence.backupId.length > 0 &&
    typeof evidence.operationId === 'string' && evidence.operationId.length > 0 &&
    typeof evidence.assetId === 'string' && evidence.assetId.length > 0 &&
    typeof evidence.nativeContactId === 'string' && evidence.nativeContactId.length > 0 &&
    typeof evidence.expectedSha256 === 'string' && SHA256.test(evidence.expectedSha256) &&
    evidence.expectedSha256 === evidence.actualSha256 &&
    typeof evidence.observedAt === 'string' && !Number.isNaN(Date.parse(evidence.observedAt));
}

function isRestorationWorkflow(workflow: CleanupWorkflow): boolean {
  return workflow.changeSet.id.includes(':restore:') || workflow.changeSet.id.includes(':undo:transaction:');
}
