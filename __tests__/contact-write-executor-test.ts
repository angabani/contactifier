import {
  CleanupWorkflowConflictError,
  ContactWriteCapabilityGate,
  ContactWriteCapabilityError,
  ExecuteContactWritePlan,
  ReconcileUnknownContactWrite,
  ResumeContactWriteFinalization,
  type ContactWriter,
  type CleanupWorkflowRepository,
  type CleanupWorkflowSummary,
} from '@/application';
import {
  createChangeSet,
  createCleanupWorkflow,
  createConfidenceScore,
  recordWorkflowPreflight,
  type CanonicalContact,
  type CleanupWorkflow,
  type ContactWritePlan,
  type ProposedChange,
} from '@/domain';
import {
  SIMULATED_CONTACT_WRITER_ADAPTER_ID,
  SimulatedContactWriter,
  simulatedContactWriterCertification,
} from '@/infrastructure/contacts/simulation';

const at = '2026-08-19T10:00:00.000Z';
const source = { kind: 'device' as const };

function contact(id: string, name = id): CanonicalContact {
  return {
    id,
    recordRef: { source, sourceContactId: `native-${id}` },
    displayName: name,
    name: { givenName: name },
    nicknames: [],
    phoneNumbers: [],
    emailAddresses: [],
    postalAddresses: [],
    organizations: [],
    urls: [],
    birthdays: [],
    events: [],
    notes: [],
    groups: [],
    photos: [],
    extensions: {},
  };
}

class MemoryRepository implements CleanupWorkflowRepository {
  private current: CleanupWorkflow | null = null;
  discard(): Promise<void> {
    this.current = null;
    return Promise.resolve();
  }
  load(): Promise<CleanupWorkflow | null> {
    return Promise.resolve(this.current);
  }
  listResumable(): Promise<readonly CleanupWorkflowSummary[]> {
    return Promise.resolve([]);
  }
  save(workflow: CleanupWorkflow, expectedRevision: number | null): Promise<void> {
    if (
      (expectedRevision === null && this.current) ||
      (expectedRevision !== null && this.current?.revision !== expectedRevision)
    ) {
      throw new CleanupWorkflowConflictError(workflow.id);
    }
    this.current = workflow;
    return Promise.resolve();
  }
}

function preparedWorkflow(includeDelete = false): { workflow: CleanupWorkflow; contacts: CanonicalContact[] } {
  const a = contact('a', 'Before');
  const b = contact('b');
  const after = contact('a', 'After');
  const update: ProposedChange = {
    id: 'change-a',
    kind: 'update',
    contactId: 'a',
    before: a,
    after,
    origin: 'user',
    confidence: createConfidenceScore(1),
    reasons: ['Test'],
    decision: 'accepted',
  };
  const remove: ProposedChange = {
    id: 'change-b',
    kind: 'delete',
    contactId: 'b',
    before: b,
    origin: 'user',
    confidence: createConfidenceScore(1),
    reasons: ['Test'],
    decision: 'accepted',
  };
  const changes = createChangeSet({
    id: 'changes-1',
    snapshotId: 'snapshot-1',
    createdAt: at,
    changes: includeDelete ? [update, remove] : [update],
  });
  const operations: ContactWritePlan['operations'] = [
    {
      id: 'change-a:update:0',
      changeId: 'change-a',
      kind: 'update',
      sourceContactId: 'native-a',
      before: a,
      after,
    },
    ...(includeDelete
      ? [{
          id: 'change-b:delete:0',
          changeId: 'change-b',
          kind: 'delete' as const,
          sourceContactId: 'native-b',
          before: b,
        }]
      : []),
  ];
  const plan: ContactWritePlan = {
    mode: 'dry-run',
    changeSetId: changes.id,
    analyzedSnapshotId: 'snapshot-1',
    freshSnapshotId: 'snapshot-2',
    backupId: 'backup-1',
    plannedAt: at,
    operations,
    compensations: [
      ...(includeDelete
        ? [{ kind: 'recreate-deleted' as const, operationId: 'change-b:delete:0', contact: b }]
        : []),
      { kind: 'restore-update', operationId: 'change-a:update:0', contact: a },
    ],
    createCount: 0,
    updateCount: 1,
    deleteCount: includeDelete ? 1 : 0,
  };
  const initial = createCleanupWorkflow({
    id: 'workflow-1',
    source,
    snapshotId: 'snapshot-1',
    backupId: 'backup-1',
    changeSet: changes,
    createdAt: at,
  });
  return {
    workflow: recordWorkflowPreflight(initial, plan, at),
    contacts: [a, b],
  };
}

function preparedCreateWorkflow(): { workflow: CleanupWorkflow; contacts: CanonicalContact[] } {
  const a = contact('a');
  const b = contact('b');
  const target = contact('merged', 'Merged');
  const changes = createChangeSet({
    id: 'create-changes',
    snapshotId: 'snapshot-1',
    createdAt: at,
    changes: [{
      id: 'create-change',
      kind: 'merge',
      contactIds: ['a', 'b'],
      before: [a, b],
      after: target,
      origin: 'user',
      confidence: createConfidenceScore(1),
      reasons: ['Test'],
      decision: 'accepted',
    }],
  });
  const operation = {
    id: 'create-change:create:0',
    changeId: 'create-change',
    kind: 'create' as const,
    contact: target,
    reconciliationMarker: 'contactifier://write/snapshot-2/create-change%3Acreate%3A0',
  };
  const plan: ContactWritePlan = {
    mode: 'dry-run',
    changeSetId: changes.id,
    analyzedSnapshotId: 'snapshot-1',
    freshSnapshotId: 'snapshot-2',
    backupId: 'backup-1',
    plannedAt: at,
    operations: [operation],
    compensations: [{ kind: 'delete-created', operationId: operation.id }],
    createCount: 1,
    updateCount: 0,
    deleteCount: 0,
  };
  return {
    workflow: recordWorkflowPreflight(createCleanupWorkflow({
      id: 'create-workflow',
      source,
      snapshotId: 'snapshot-1',
      backupId: 'backup-1',
      changeSet: changes,
      createdAt: at,
    }), plan, at),
    contacts: [a, b],
  };
}

async function executeWith(simulator: SimulatedContactWriter, workflow: CleanupWorkflow) {
  const repository = new MemoryRepository();
  await repository.save(workflow, null);
  return new ExecuteContactWritePlan(
    repository,
    simulator,
    simulator,
    { now: () => new Date(at) },
    SIMULATED_CONTACT_WRITER_ADAPTER_ID,
  ).execute(workflow, authorizationFor(workflow));
}

function authorizationFor(workflow: CleanupWorkflow) {
  return new ContactWriteCapabilityGate().authorize({
    workflow,
    certification: simulatedContactWriterCertification,
    runtime: {
      platform: 'simulation',
      fullContactAccess: true,
      explicitUserConfirmation: true,
      verifiedBackupId: workflow.backupId,
      freshSnapshotId: workflow.writePlan?.freshSnapshotId ?? '',
    },
    now: new Date(at),
  });
}

describe('simulated contact write executor', () => {
  it('denies execution when certification or runtime prerequisites are incomplete', () => {
    const prepared = preparedWorkflow();
    expect(() =>
      new ContactWriteCapabilityGate().authorize({
        workflow: prepared.workflow,
        certification: {
          ...simulatedContactWriterCertification,
          enabled: false,
          evidence: { ...simulatedContactWriterCertification.evidence, reconciliation: false },
        },
        runtime: {
          platform: 'ios',
          fullContactAccess: false,
          explicitUserConfirmation: false,
          verifiedBackupId: 'wrong-backup',
          freshSnapshotId: 'wrong-snapshot',
        },
        now: new Date(at),
      }),
    ).toThrow(ContactWriteCapabilityError);
    try {
      new ContactWriteCapabilityGate().authorize({
        workflow: prepared.workflow,
        certification: {
          ...simulatedContactWriterCertification,
          enabled: false,
          evidence: { ...simulatedContactWriterCertification.evidence, reconciliation: false },
        },
        runtime: {
          platform: 'ios',
          fullContactAccess: false,
          explicitUserConfirmation: false,
          verifiedBackupId: 'wrong-backup',
          freshSnapshotId: 'wrong-snapshot',
        },
        now: new Date(at),
      });
    } catch (error) {
      expect(error).toMatchObject({
        reasons: expect.arrayContaining([
          'adapter-disabled',
          'certification-incomplete',
          'platform-mismatch',
          'full-access-required',
          'confirmation-required',
          'backup-mismatch',
          'snapshot-mismatch',
        ]),
      });
    }
  });

  it('binds authorization to the adapter, workflow, plan, and expiration time', () => {
    const prepared = preparedWorkflow();
    const authorization = new ContactWriteCapabilityGate(1).authorize({
      workflow: prepared.workflow,
      certification: simulatedContactWriterCertification,
      runtime: {
        platform: 'simulation',
        fullContactAccess: true,
        explicitUserConfirmation: true,
        verifiedBackupId: prepared.workflow.backupId,
        freshSnapshotId: prepared.workflow.writePlan?.freshSnapshotId ?? '',
      },
      now: new Date(at),
    });

    expect(() =>
      authorization.assertMatches(prepared.workflow, 'different-adapter', new Date(at)),
    ).toThrow(ContactWriteCapabilityError);
    expect(() =>
      authorization.assertMatches(
        prepared.workflow,
        SIMULATED_CONTACT_WRITER_ADAPTER_ID,
        new Date(Date.parse(at) + 2),
      ),
    ).toThrow(ContactWriteCapabilityError);
  });

  it('journals write-ahead intent, receipts, verification, and completion', async () => {
    const prepared = preparedWorkflow();
    const simulator = new SimulatedContactWriter(prepared.contacts);
    const result = await executeWith(simulator, prepared.workflow);

    expect(result.phase).toBe('completed');
    expect(result.journal.map(({ outcome }) => outcome)).toEqual(['started', 'applied']);
    expect(result.journal[1]?.receipt).toMatchObject({ operationId: 'change-a:update:0' });
    expect(simulator.contacts().find(({ id }) => id === 'a')?.displayName).toBe('After');
  });

  it('resumes idempotent marker finalization under a fresh authorization', async () => {
    const prepared = preparedCreateWorkflow();
    const simulator = new SimulatedContactWriter(prepared.contacts);
    const repository = new MemoryRepository();
    await repository.save(prepared.workflow, null);
    let interruptOnce = true;
    const interruptedWriter: ContactWriter = {
      apply: (operation) => simulator.apply(operation),
      compensate: (compensation, receipt) => simulator.compensate(compensation, receipt),
      finalize: async (operation, receipt) => {
        const result = await simulator.finalize(operation, receipt);
        if (interruptOnce) {
          interruptOnce = false;
          throw new Error('Response lost after marker removal.');
        }
        return result;
      },
    };
    const failed = await new ExecuteContactWritePlan(
      repository,
      interruptedWriter,
      simulator,
      { now: () => new Date(at) },
      SIMULATED_CONTACT_WRITER_ADAPTER_ID,
    ).execute(prepared.workflow, authorizationFor(prepared.workflow));

    expect(failed).toMatchObject({
      phase: 'failed',
      failure: { code: 'finalization-outcome-unknown', recoverable: true },
    });
    expect(failed.journal.map(({ outcome }) => outcome)).toEqual([
      'started',
      'applied',
      'finalization-started',
    ]);
    const gate = new ContactWriteCapabilityGate();
    const authorization = gate.authorizeFinalization({
      workflow: failed,
      certification: simulatedContactWriterCertification,
      runtime: {
        platform: 'simulation',
        fullContactAccess: true,
        explicitUserConfirmation: true,
        verifiedBackupId: failed.backupId,
        freshSnapshotId: failed.writePlan?.freshSnapshotId ?? '',
      },
      now: new Date(at),
    });
    const completed = await new ResumeContactWriteFinalization(
      repository,
      interruptedWriter,
      { now: () => new Date(at) },
      SIMULATED_CONTACT_WRITER_ADAPTER_ID,
    ).execute(failed, authorization);

    expect(completed.phase).toBe('completed');
    expect(completed.journal.at(-1)?.finalizationReceipt).toMatchObject({
      operationId: 'create-change:create:0',
    });
    expect(completed.journal.at(-1)?.origin).toBe('recovery');
  });

  it('rolls back prior writes after an injected definitely-not-applied failure', async () => {
    const prepared = preparedWorkflow(true);
    const simulator = new SimulatedContactWriter(prepared.contacts, {
      failBeforeOperationId: 'change-b:delete:0',
    });
    const result = await executeWith(simulator, prepared.workflow);

    expect(result.phase).toBe('rolled-back');
    expect(result.rollbackCause).toBe('write-rejected');
    expect(result.journal.map(({ outcome }) => outcome)).toEqual([
      'started',
      'applied',
      'started',
      'not-applied',
      'compensated',
    ]);
    expect(result.journal.at(-1)?.compensationReceipt).toEqual({
      operationId: 'change-a:update:0',
      kind: 'restore-update',
      restoredSourceContactId: 'native-a',
    });
    expect(simulator.contacts().find(({ id }) => id === 'a')?.displayName).toBe('Before');
    expect(simulator.contacts()).toHaveLength(2);
  });

  it('rolls back all applied writes when post-write verification fails', async () => {
    const prepared = preparedWorkflow();
    const simulator = new SimulatedContactWriter(prepared.contacts, {
      forceVerificationFailure: true,
    });
    const result = await executeWith(simulator, prepared.workflow);

    expect(result.phase).toBe('rolled-back');
    expect(result.rollbackCause).toBe('verification-failed');
    expect(simulator.contacts().find(({ id }) => id === 'a')?.displayName).toBe('Before');
  });

  it('does not guess or compensate when a writer outcome is unknown', async () => {
    const prepared = preparedWorkflow();
    const simulator = new SimulatedContactWriter(prepared.contacts);
    const uncertainWriter: ContactWriter = {
      apply: async (operation) => {
        await simulator.apply(operation);
        throw new Error('Connection ended after the side effect.');
      },
      compensate: (compensation, receipt) => simulator.compensate(compensation, receipt),
      finalize: (operation, receipt) => simulator.finalize(operation, receipt),
    };
    const repository = new MemoryRepository();
    await repository.save(prepared.workflow, null);
    const result = await new ExecuteContactWritePlan(
      repository,
      uncertainWriter,
      simulator,
      { now: () => new Date(at) },
      SIMULATED_CONTACT_WRITER_ADAPTER_ID,
    ).execute(prepared.workflow, authorizationFor(prepared.workflow));

    expect(result).toMatchObject({
      phase: 'failed',
      failure: { code: 'write-outcome-unknown', recoverable: true },
    });
    expect(result.journal.map(({ outcome }) => outcome)).toEqual(['started']);
    expect(simulator.contacts().find(({ id }) => id === 'a')?.displayName).toBe('After');
  });

  it('reconciles a confirmed applied outcome and rolls it back', async () => {
    const prepared = preparedWorkflow();
    const simulator = new SimulatedContactWriter(prepared.contacts);
    const repository = new MemoryRepository();
    await repository.save(prepared.workflow, null);
    const failed = await new ExecuteContactWritePlan(
      repository,
      {
        apply: async (operation) => {
          await simulator.apply(operation);
          throw new Error('Lost response');
        },
        compensate: (compensation, receipt) => simulator.compensate(compensation, receipt),
        finalize: (operation, receipt) => simulator.finalize(operation, receipt),
      },
      simulator,
      { now: () => new Date(at) },
      SIMULATED_CONTACT_WRITER_ADAPTER_ID,
    ).execute(prepared.workflow, authorizationFor(prepared.workflow));

    const reconciled = await new ReconcileUnknownContactWrite(
      repository,
      simulator,
      simulator,
      { now: () => new Date(at) },
    ).execute(failed);

    expect(reconciled.phase).toBe('rolled-back');
    expect(reconciled.rollbackCause).toBe('reconciled-write');
    expect(reconciled.journal.map(({ outcome }) => outcome)).toEqual([
      'started',
      'applied',
      'compensated',
    ]);
    expect(reconciled.journal.find(({ outcome }) => outcome === 'applied')?.origin).toBe('reconciliation');
    expect(reconciled.journal.at(-1)?.compensationReceipt).toMatchObject({
      operationId: 'change-a:update:0',
      kind: 'restore-update',
    });
    expect(simulator.contacts().find(({ id }) => id === 'a')?.displayName).toBe('Before');
  });

  it('resolves a confirmed not-applied outcome without inventing compensation', async () => {
    const prepared = preparedWorkflow();
    const simulator = new SimulatedContactWriter(prepared.contacts);
    const repository = new MemoryRepository();
    await repository.save(prepared.workflow, null);
    const failed = await new ExecuteContactWritePlan(
      repository,
      {
        apply: () => Promise.reject(new Error('No result available')),
        compensate: (compensation, receipt) => simulator.compensate(compensation, receipt),
        finalize: (operation, receipt) => simulator.finalize(operation, receipt),
      },
      simulator,
      { now: () => new Date(at) },
      SIMULATED_CONTACT_WRITER_ADAPTER_ID,
    ).execute(prepared.workflow, authorizationFor(prepared.workflow));

    const reconciled = await new ReconcileUnknownContactWrite(
      repository,
      simulator,
      simulator,
      { now: () => new Date(at) },
    ).execute(failed);

    expect(reconciled.phase).toBe('rolled-back');
    expect(reconciled.rollbackCause).toBe('reconciled-write');
    expect(reconciled.journal.map(({ outcome }) => outcome)).toEqual(['started', 'not-applied']);
    expect(reconciled.journal.at(-1)?.origin).toBe('reconciliation');
  });

  it('requires manual review when live state matches neither before nor after', async () => {
    const prepared = preparedWorkflow();
    const originalSimulator = new SimulatedContactWriter(prepared.contacts);
    const repository = new MemoryRepository();
    await repository.save(prepared.workflow, null);
    const failed = await new ExecuteContactWritePlan(
      repository,
      {
        apply: () => Promise.reject(new Error('No result available')),
        compensate: (compensation, receipt) =>
          originalSimulator.compensate(compensation, receipt),
        finalize: (operation, receipt) => originalSimulator.finalize(operation, receipt),
      },
      originalSimulator,
      { now: () => new Date(at) },
      SIMULATED_CONTACT_WRITER_ADAPTER_ID,
    ).execute(prepared.workflow, authorizationFor(prepared.workflow));
    const externallyChanged = new SimulatedContactWriter([
      contact('a', 'External change'),
      contact('b'),
    ]);

    const reconciled = await new ReconcileUnknownContactWrite(
      repository,
      externallyChanged,
      externallyChanged,
      { now: () => new Date(at) },
    ).execute(failed);

    expect(reconciled).toMatchObject({
      phase: 'failed',
      failure: { code: 'manual-review-required', recoverable: false },
    });
    expect(reconciled.journal.at(-1)?.outcome).toBe('ambiguous');
    expect(reconciled.journal.at(-1)?.origin).toBe('reconciliation');
  });
});
