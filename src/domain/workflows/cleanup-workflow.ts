import { createChangeSet } from '../changes/create-change-set';
import { validateContactWritePlan, type ContactWritePlan } from '../changes/contact-write-plan';
import type { ChangeSet, ProposedChange } from '../changes/proposed-change';
import type { ContactSourceRef } from '../contacts/contact-source';
import { isSameContactSource } from '../contacts/contact-source';
import { assertDomain } from '../shared/invariant';

export type CleanupWorkflowPhase =
  | 'applying'
  | 'completed'
  | 'failed'
  | 'finalizing'
  | 'preflighted'
  | 'reviewing'
  | 'rolled-back'
  | 'rolling-back'
  | 'verifying';

export interface CleanupWorkflowFailure {
  readonly code: string;
  readonly recoverable: boolean;
  readonly failedFrom: Exclude<CleanupWorkflowPhase, 'failed'>;
}

export interface CleanupWorkflowJournalEntry {
  readonly operationId: string;
  readonly outcome: 'ambiguous' | 'applied' | 'compensated' | 'finalization-started' | 'finalized' | 'not-applied' | 'started';
  readonly recordedAt: string;
  readonly receipt?: ContactWriteReceipt;
  readonly compensationReceipt?: ContactWriteCompensationReceipt;
  readonly finalizationReceipt?: ContactWriteFinalizationReceipt;
}

export interface ContactWriteReceipt {
  readonly operationId: string;
  readonly sourceContactId: string;
  readonly sourceRevision?: string;
}

export type ContactWriteCompensationReceipt =
  | {
      readonly operationId: string;
      readonly kind: 'delete-created';
      readonly deletedSourceContactId: string;
    }
  | {
      readonly operationId: string;
      readonly kind: 'recreate-deleted' | 'restore-update';
      readonly restoredSourceContactId: string;
    };

export interface ContactWriteFinalizationReceipt {
  readonly operationId: string;
  readonly sourceContactId: string;
  readonly removedReconciliationMarker: string;
}

export interface CleanupWorkflow {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly phase: CleanupWorkflowPhase;
  readonly source: ContactSourceRef;
  readonly snapshotId: string;
  readonly backupId: string;
  readonly changeSet: ChangeSet;
  readonly writePlan?: ContactWritePlan;
  readonly journal: readonly CleanupWorkflowJournalEntry[];
  readonly failure?: CleanupWorkflowFailure;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class CleanupWorkflowTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CleanupWorkflowTransitionError';
  }
}

function validDate(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function changeUsesSource(change: ProposedChange, source: ContactSourceRef): boolean {
  const before = change.kind === 'merge' ? change.before : [change.before];
  return (
    before.every(({ recordRef }) => isSameContactSource(recordRef.source, source)) &&
    (change.kind === 'delete' || isSameContactSource(change.after.recordRef.source, source))
  );
}

export function validateCleanupWorkflow(workflow: CleanupWorkflow): CleanupWorkflow {
  assertDomain(workflow.schemaVersion === 1, 'Unsupported cleanup workflow schema.');
  assertDomain(
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(workflow.id),
    'Cleanup workflow id must be a safe portable identifier.',
  );
  assertDomain(
    Number.isSafeInteger(workflow.revision) && workflow.revision >= 0,
    'Cleanup workflow revision must be a non-negative integer.',
  );
  assertDomain(workflow.snapshotId.trim().length > 0, 'Cleanup workflow snapshot id is required.');
  assertDomain(workflow.backupId.trim().length > 0, 'Cleanup workflow backup id is required.');
  assertDomain(validDate(workflow.createdAt), 'Cleanup workflow createdAt must be valid.');
  assertDomain(validDate(workflow.updatedAt), 'Cleanup workflow updatedAt must be valid.');
  assertDomain(
    Date.parse(workflow.updatedAt) >= Date.parse(workflow.createdAt),
    'Cleanup workflow updatedAt cannot precede createdAt.',
  );
  assertDomain(
    workflow.changeSet.snapshotId === workflow.snapshotId,
    'Cleanup workflow change set targets another snapshot.',
  );
  createChangeSet(workflow.changeSet);
  assertDomain(
    workflow.changeSet.changes.every((change) => changeUsesSource(change, workflow.source)),
    'Cleanup workflow changes must belong to its contact source.',
  );
  if (
    workflow.phase === 'preflighted' ||
    workflow.phase === 'applying' ||
    workflow.phase === 'finalizing' ||
    workflow.phase === 'verifying' ||
    workflow.phase === 'rolling-back' ||
    workflow.phase === 'rolled-back'
  ) {
    assertDomain(workflow.writePlan, `Cleanup workflow phase ${workflow.phase} requires a write plan.`);
  }
  if (workflow.phase === 'completed') {
    assertDomain(workflow.writePlan, 'Completed cleanup workflow requires a write plan.');
  }
  if (workflow.phase === 'failed') {
    assertDomain(workflow.failure, 'Failed cleanup workflow requires failure metadata.');
  } else {
    assertDomain(!workflow.failure, 'Only failed cleanup workflows may contain failure metadata.');
  }
  if (workflow.writePlan) {
    validateContactWritePlan(workflow.writePlan);
    assertDomain(
      workflow.writePlan.changeSetId === workflow.changeSet.id &&
        workflow.writePlan.analyzedSnapshotId === workflow.snapshotId,
      'Cleanup workflow write plan does not match its reviewed changes.',
    );
  }
  const operationIds = new Set(workflow.writePlan?.operations.map(({ id }) => id) ?? []);
  const applied = new Set<string>();
  const compensated = new Set<string>();
  const started = new Set<string>();
  const notApplied = new Set<string>();
  const ambiguous = new Set<string>();
  const finalizationStarted = new Set<string>();
  const finalized = new Set<string>();
  let previousJournalTime = workflow.createdAt;
  for (const entry of workflow.journal) {
    assertDomain(operationIds.has(entry.operationId), `Journal references unknown operation: ${entry.operationId}.`);
    assertDomain(validDate(entry.recordedAt), 'Workflow journal time must be valid.');
    assertDomain(
      Date.parse(entry.recordedAt) >= Date.parse(previousJournalTime),
      'Workflow journal entries must be chronological.',
    );
    previousJournalTime = entry.recordedAt;
    assertDomain(
      ['ambiguous', 'applied', 'compensated', 'finalization-started', 'finalized', 'not-applied', 'started'].includes(entry.outcome),
      `Journal entry for ${entry.operationId} has an invalid outcome.`,
    );
    if (entry.outcome === 'started') {
      assertDomain(!started.has(entry.operationId), `Operation ${entry.operationId} was started twice.`);
      assertDomain(!entry.receipt, 'Started operation cannot contain a receipt.');
      assertDomain(!entry.compensationReceipt, 'Started operation cannot contain a compensation receipt.');
      assertDomain(!entry.finalizationReceipt, 'Started operation cannot contain a finalization receipt.');
      started.add(entry.operationId);
    } else if (entry.outcome === 'applied') {
      assertDomain(started.has(entry.operationId), `Operation ${entry.operationId} was not started.`);
      assertDomain(
        !notApplied.has(entry.operationId) && !ambiguous.has(entry.operationId),
        `Operation ${entry.operationId} was already reconciled.`,
      );
      assertDomain(!applied.has(entry.operationId), `Operation ${entry.operationId} was applied twice.`);
      assertDomain(
        entry.receipt?.operationId === entry.operationId && entry.receipt.sourceContactId.trim().length > 0,
        `Operation ${entry.operationId} requires a matching write receipt.`,
      );
      assertDomain(!entry.compensationReceipt, 'Applied operation cannot contain a compensation receipt.');
      assertDomain(!entry.finalizationReceipt, 'Applied operation cannot contain a finalization receipt.');
      applied.add(entry.operationId);
    } else if (entry.outcome === 'compensated') {
      assertDomain(!entry.receipt, 'Compensated operation cannot contain a receipt.');
      const prepared = workflow.writePlan?.compensations.find(
        ({ operationId }) => operationId === entry.operationId,
      );
      assertDomain(
        entry.compensationReceipt?.operationId === entry.operationId &&
          entry.compensationReceipt.kind === prepared?.kind,
        `Operation ${entry.operationId} requires a matching compensation receipt.`,
      );
      const compensatedSourceId = entry.compensationReceipt &&
        (entry.compensationReceipt.kind === 'delete-created'
          ? entry.compensationReceipt.deletedSourceContactId
          : entry.compensationReceipt.restoredSourceContactId);
      assertDomain(
        !!compensatedSourceId?.trim(),
        `Operation ${entry.operationId} compensation receipt requires a native contact identifier.`,
      );
      assertDomain(applied.has(entry.operationId), `Operation ${entry.operationId} was not applied.`);
      assertDomain(!compensated.has(entry.operationId), `Operation ${entry.operationId} was compensated twice.`);
      assertDomain(!entry.finalizationReceipt, 'Compensated operation cannot contain a finalization receipt.');
      compensated.add(entry.operationId);
    } else if (entry.outcome === 'finalization-started' || entry.outcome === 'finalized') {
      const operation = workflow.writePlan?.operations.find(({ id }) => id === entry.operationId);
      assertDomain(operation?.kind === 'create', 'Only create operations require finalization.');
      assertDomain(applied.has(entry.operationId), `Operation ${entry.operationId} was not applied.`);
      assertDomain(!entry.receipt && !entry.compensationReceipt, 'Finalization cannot contain write or compensation receipts.');
      if (entry.outcome === 'finalization-started') {
        assertDomain(!finalizationStarted.has(entry.operationId), `Operation ${entry.operationId} finalization started twice.`);
        assertDomain(!entry.finalizationReceipt, 'Finalization start cannot contain a receipt.');
        finalizationStarted.add(entry.operationId);
      } else {
        assertDomain(finalizationStarted.has(entry.operationId), `Operation ${entry.operationId} finalization was not started.`);
        assertDomain(!finalized.has(entry.operationId), `Operation ${entry.operationId} was finalized twice.`);
        assertDomain(
          entry.finalizationReceipt?.operationId === entry.operationId &&
            entry.finalizationReceipt.sourceContactId.trim().length > 0 &&
            entry.finalizationReceipt.removedReconciliationMarker === operation.reconciliationMarker,
          `Operation ${entry.operationId} requires a matching finalization receipt.`,
        );
        finalized.add(entry.operationId);
      }
    } else {
      assertDomain(started.has(entry.operationId), `Operation ${entry.operationId} was not started.`);
      assertDomain(!applied.has(entry.operationId), `Operation ${entry.operationId} was already applied.`);
      assertDomain(!entry.receipt, 'Unapplied or ambiguous operation cannot contain a receipt.');
      assertDomain(
        !entry.compensationReceipt,
        'Unapplied or ambiguous operation cannot contain a compensation receipt.',
      );
      assertDomain(!entry.finalizationReceipt, 'Unapplied or ambiguous operation cannot contain a finalization receipt.');
      assertDomain(
        !notApplied.has(entry.operationId) && !ambiguous.has(entry.operationId),
        `Operation ${entry.operationId} was reconciled twice.`,
      );
      const target = entry.outcome === 'not-applied' ? notApplied : ambiguous;
      target.add(entry.operationId);
    }
  }
  if (workflow.phase === 'verifying' || workflow.phase === 'completed') {
    assertDomain(applied.size === operationIds.size, `${workflow.phase} requires every write to be applied.`);
  }
  if (workflow.phase === 'completed') {
    const createIds = [...operationIds].filter(
      (operationId) => workflow.writePlan?.operations.find(({ id }) => id === operationId)?.kind === 'create',
    );
    assertDomain(createIds.every((operationId) => finalized.has(operationId)), 'Completed workflow requires every create marker to be finalized.');
  }
  if (workflow.phase === 'rolled-back') {
    assertDomain(
      [...started].every(
        (operationId) =>
          notApplied.has(operationId) ||
          (applied.has(operationId) && compensated.has(operationId)),
      ),
      'Rolled-back workflow requires every started write to be resolved.',
    );
  }
  return workflow;
}

export function createCleanupWorkflow(input: {
  readonly id: string;
  readonly source: ContactSourceRef;
  readonly snapshotId: string;
  readonly backupId: string;
  readonly changeSet: ChangeSet;
  readonly createdAt: string;
}): CleanupWorkflow {
  return validateCleanupWorkflow(
    Object.freeze({
      ...input,
      schemaVersion: 1,
      revision: 0,
      phase: 'reviewing',
      journal: Object.freeze([]),
      updatedAt: input.createdAt,
    }),
  );
}

function revised(
  workflow: CleanupWorkflow,
  patch: Partial<CleanupWorkflow>,
  updatedAt: string,
): CleanupWorkflow {
  if (!validDate(updatedAt) || Date.parse(updatedAt) < Date.parse(workflow.updatedAt)) {
    throw new CleanupWorkflowTransitionError('Workflow transition time cannot move backwards.');
  }
  return validateCleanupWorkflow(
    Object.freeze({
      ...workflow,
      ...patch,
      revision: workflow.revision + 1,
      updatedAt,
    }),
  );
}

export function recordWorkflowReview(
  workflow: CleanupWorkflow,
  changeSet: ChangeSet,
  updatedAt: string,
): CleanupWorkflow {
  if (workflow.phase !== 'reviewing' && workflow.phase !== 'preflighted') {
    throw new CleanupWorkflowTransitionError(`Cannot review workflow from ${workflow.phase}.`);
  }
  if (changeSet.id !== workflow.changeSet.id || changeSet.snapshotId !== workflow.snapshotId) {
    throw new CleanupWorkflowTransitionError('Reviewed change set does not belong to this workflow.');
  }
  return revised(
    workflow,
    { phase: 'reviewing', changeSet, writePlan: undefined, journal: Object.freeze([]), failure: undefined },
    updatedAt,
  );
}

export function recordWorkflowPreflight(
  workflow: CleanupWorkflow,
  writePlan: ContactWritePlan,
  updatedAt: string,
): CleanupWorkflow {
  if (workflow.phase !== 'reviewing') {
    throw new CleanupWorkflowTransitionError(`Cannot preflight workflow from ${workflow.phase}.`);
  }
  if (workflow.changeSet.changes.some(({ decision }) => decision === 'pending')) {
    throw new CleanupWorkflowTransitionError('Every change must be reviewed before preflight.');
  }
  if (
    writePlan.changeSetId !== workflow.changeSet.id ||
    writePlan.analyzedSnapshotId !== workflow.snapshotId ||
    writePlan.backupId !== workflow.backupId
  ) {
    throw new CleanupWorkflowTransitionError('Write plan does not belong to this workflow.');
  }
  return revised(
    workflow,
    { phase: 'preflighted', writePlan, journal: Object.freeze([]), failure: undefined },
    updatedAt,
  );
}

export function recordWorkflowOperation(
  workflow: CleanupWorkflow,
  operationId: string,
  outcome: 'applied' | 'not-applied' | 'started',
  recordedAt: string,
  receipt?: ContactWriteReceipt,
): CleanupWorkflow {
  if (
    workflow.phase !== 'applying'
  ) {
    throw new CleanupWorkflowTransitionError(
      `Cannot record ${outcome} operation while workflow is ${workflow.phase}.`,
    );
  }
  return revised(
    workflow,
    { journal: Object.freeze([...workflow.journal, { operationId, outcome, recordedAt, receipt }]) },
    recordedAt,
  );
}

export function recordWorkflowCompensation(
  workflow: CleanupWorkflow,
  compensationReceipt: ContactWriteCompensationReceipt,
  recordedAt: string,
): CleanupWorkflow {
  if (workflow.phase !== 'rolling-back') {
    throw new CleanupWorkflowTransitionError(
      `Cannot record compensated operation while workflow is ${workflow.phase}.`,
    );
  }
  const applied = new Set(
    workflow.journal
      .filter((entry) => entry.outcome === 'applied')
      .map((entry) => entry.operationId),
  );
  const compensated = new Set(
    workflow.journal
      .filter((entry) => entry.outcome === 'compensated')
      .map((entry) => entry.operationId),
  );
  const nextCompensation = workflow.writePlan?.compensations.find(
    (entry) => applied.has(entry.operationId) && !compensated.has(entry.operationId),
  );
  if (
    nextCompensation?.operationId !== compensationReceipt.operationId ||
    nextCompensation.kind !== compensationReceipt.kind
  ) {
    throw new CleanupWorkflowTransitionError('Compensations must follow the prepared rollback order.');
  }
  return revised(
    workflow,
    {
      journal: Object.freeze([
        ...workflow.journal,
        {
          operationId: compensationReceipt.operationId,
          outcome: 'compensated' as const,
          recordedAt,
          compensationReceipt,
        },
      ]),
    },
    recordedAt,
  );
}

export function recordWorkflowFinalization(
  workflow: CleanupWorkflow,
  operationId: string,
  outcome: 'finalization-started' | 'finalized',
  recordedAt: string,
  finalizationReceipt?: ContactWriteFinalizationReceipt,
): CleanupWorkflow {
  if (workflow.phase !== 'finalizing') {
    throw new CleanupWorkflowTransitionError(`Cannot record ${outcome} while workflow is ${workflow.phase}.`);
  }
  return revised(
    workflow,
    { journal: Object.freeze([...workflow.journal, { operationId, outcome, recordedAt, finalizationReceipt }]) },
    recordedAt,
  );
}

export function recordWorkflowReconciliation(
  workflow: CleanupWorkflow,
  operationId: string,
  outcome: 'ambiguous' | 'applied' | 'not-applied',
  recordedAt: string,
  receipt?: ContactWriteReceipt,
): CleanupWorkflow {
  if (workflow.phase !== 'failed' || workflow.failure?.code !== 'write-outcome-unknown') {
    throw new CleanupWorkflowTransitionError('Only an unknown write outcome can be reconciled.');
  }
  const next = revised(
    workflow,
    {
      journal: Object.freeze([
        ...workflow.journal,
        { operationId, outcome, recordedAt, receipt },
      ]),
      failure:
        outcome === 'ambiguous'
          ? { code: 'manual-review-required', recoverable: false, failedFrom: 'applying' }
          : workflow.failure,
    },
    recordedAt,
  );
  return next;
}

const allowedTransitions: Readonly<Record<CleanupWorkflowPhase, readonly CleanupWorkflowPhase[]>> = {
  reviewing: ['failed'],
  preflighted: ['applying', 'failed'],
  applying: ['verifying', 'rolling-back', 'failed'],
  verifying: ['finalizing', 'rolling-back', 'failed'],
  finalizing: ['completed', 'failed'],
  failed: ['reviewing', 'rolling-back', 'finalizing'],
  'rolling-back': ['rolled-back', 'failed'],
  completed: [],
  'rolled-back': [],
};

export function transitionCleanupWorkflow(
  workflow: CleanupWorkflow,
  phase: CleanupWorkflowPhase,
  updatedAt: string,
  failure?: Omit<CleanupWorkflowFailure, 'failedFrom'>,
): CleanupWorkflow {
  if (!allowedTransitions[workflow.phase].includes(phase)) {
    throw new CleanupWorkflowTransitionError(
      `Cannot transition cleanup workflow from ${workflow.phase} to ${phase}.`,
    );
  }
  if (phase === 'failed' && !failure) {
    throw new CleanupWorkflowTransitionError('A failed workflow requires failure metadata.');
  }
  if (phase !== 'failed' && failure) {
    throw new CleanupWorkflowTransitionError('Failure metadata is valid only for failed workflows.');
  }
  if (phase === 'rolling-back' && !workflow.writePlan) {
    throw new CleanupWorkflowTransitionError('Rollback requires a prepared write plan.');
  }
  return revised(
    workflow,
    {
      phase,
      failure:
        phase === 'failed' && failure
          ? { ...failure, failedFrom: workflow.phase as Exclude<CleanupWorkflowPhase, 'failed'> }
          : undefined,
      writePlan: phase === 'reviewing' ? undefined : workflow.writePlan,
    },
    updatedAt,
  );
}

export function workflowUsesSource(
  workflow: CleanupWorkflow,
  source: ContactSourceRef,
): boolean {
  return isSameContactSource(workflow.source, source);
}
