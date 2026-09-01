import type { ContactWriteDenialReason } from '@/application';
import type { CleanupWorkflow } from '@/domain';
import { isSimulatorFixtureWritePlanOwned } from './simulator-fixture-write-policy';

export interface IosPermissionDenialEvidence {
  readonly schemaVersion: 1;
  readonly scenario: 'permission-change';
  readonly workflowId: string;
  readonly backupId: string;
  readonly observedAt: string;
  readonly denialReason: 'full-access-required';
  readonly revisionBefore: number;
  readonly revisionAfter: number;
  readonly journalEntriesBefore: number;
  readonly journalEntriesAfter: number;
}

function isOwnedPreflight(workflow: CleanupWorkflow): boolean {
  return workflow.phase === 'preflighted' &&
    Boolean(workflow.writePlan && isSimulatorFixtureWritePlanOwned(workflow.writePlan));
}

export function createIosPermissionDenialEvidence(input: {
  readonly before: CleanupWorkflow;
  readonly after: CleanupWorkflow;
  readonly denialReasons: readonly ContactWriteDenialReason[];
  readonly observedAt: string;
}): IosPermissionDenialEvidence {
  const { before, after } = input;
  if (!isOwnedPreflight(before) || !isOwnedPreflight(after)) {
    throw new Error('Permission evidence requires an owned preflight workflow.');
  }
  if (before.id !== after.id || before.backupId !== after.backupId) {
    throw new Error('Permission evidence must compare the same workflow.');
  }
  if (
    before.revision !== after.revision ||
    before.journal.length !== after.journal.length ||
    before.updatedAt !== after.updatedAt
  ) {
    throw new Error('The workflow changed during the permission-denial trial.');
  }
  if (input.denialReasons.length !== 1 || input.denialReasons[0] !== 'full-access-required') {
    throw new Error('The trial was not denied solely because full contact access was unavailable.');
  }
  if (Number.isNaN(Date.parse(input.observedAt))) throw new Error('Permission evidence timestamp is invalid.');
  return Object.freeze({
    schemaVersion: 1,
    scenario: 'permission-change',
    workflowId: before.id,
    backupId: before.backupId,
    observedAt: input.observedAt,
    denialReason: 'full-access-required',
    revisionBefore: before.revision,
    revisionAfter: after.revision,
    journalEntriesBefore: before.journal.length,
    journalEntriesAfter: after.journal.length,
  });
}

export function isIosPermissionDenialEvidence(value: unknown): value is IosPermissionDenialEvidence {
  if (!value || typeof value !== 'object') return false;
  const evidence = value as Partial<IosPermissionDenialEvidence>;
  return evidence.schemaVersion === 1 &&
    evidence.scenario === 'permission-change' &&
    evidence.denialReason === 'full-access-required' &&
    typeof evidence.workflowId === 'string' && evidence.workflowId.length > 0 &&
    typeof evidence.backupId === 'string' && evidence.backupId.length > 0 &&
    typeof evidence.observedAt === 'string' && !Number.isNaN(Date.parse(evidence.observedAt)) &&
    Number.isInteger(evidence.revisionBefore) && evidence.revisionBefore === evidence.revisionAfter &&
    Number.isInteger(evidence.journalEntriesBefore) &&
    evidence.journalEntriesBefore === evidence.journalEntriesAfter;
}
