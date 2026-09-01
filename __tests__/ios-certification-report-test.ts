import { createIosCertificationReport } from '@/features/developer/ios-certification-report';
import { createConfidenceScore, type CanonicalContact, type CleanupWorkflow } from '@/domain';

function completedWorkflow(input: { readonly id: string; readonly changeSetId: string; readonly rich?: boolean }): CleanupWorkflow {
  const contact: CanonicalContact = {
    id: 'a', recordRef: { source: { kind: 'device' }, sourceContactId: 'native-a' }, displayName: '[Contactifier Test] A',
    name: input.rich ? { givenName: '[Contactifier Test] A', prefix: 'Dr.', phoneticGivenName: 'Test' } : { givenName: '[Contactifier Test] A' }, nicknames: [],
    phoneNumbers: [], emailAddresses: [],
    postalAddresses: input.rich ? [{ id: 'address', value: { city: 'Pune' }, origin: 'source' }] : [],
    organizations: input.rich ? [{ id: 'org', value: { name: 'Contactifier' }, origin: 'source' }] : [],
    urls: [
      { id: 'marker', value: 'contactifier://certification-fixture/test/a', label: 'fixture', origin: 'source' },
      ...(input.rich ? [{ id: 'website', value: 'https://example.test', origin: 'source' as const }] : []),
    ],
    birthdays: input.rich ? [{ id: 'birthday', value: { month: 1, day: 2 }, origin: 'source' }] : [],
    events: [], notes: [], groups: input.rich ? ['certification-group'] : [], photos: [], extensions: {},
  };
  return {
    id: input.id, schemaVersion: 1, revision: 4, phase: 'completed', source: { kind: 'device' },
    snapshotId: 'snapshot', backupId: 'backup', createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:04:00.000Z',
    changeSet: {
      id: input.changeSetId, snapshotId: 'snapshot', createdAt: '2026-08-23T00:00:00.000Z',
      changes: [{ id: 'update-a', kind: 'update', contactId: 'a', before: contact, after: contact,
        origin: 'rule', confidence: createConfidenceScore(1), reasons: ['test'], decision: 'accepted' }],
    },
    writePlan: {
      mode: 'dry-run', changeSetId: input.changeSetId, analyzedSnapshotId: 'snapshot', freshSnapshotId: 'fresh',
      backupId: 'backup', plannedAt: '2026-08-23T00:01:00.000Z',
      operations: [{ id: 'update-a:update:0', changeId: 'update-a', kind: 'update',
        sourceContactId: 'native-a', before: contact, after: contact }],
      compensations: [{ kind: 'restore-update', operationId: 'update-a:update:0', contact }],
      createCount: 0, updateCount: 1, deleteCount: 0,
    },
    journal: [
      { operationId: 'update-a:update:0', outcome: 'started', recordedAt: '2026-08-23T00:02:00.000Z' },
      { operationId: 'update-a:update:0', outcome: 'applied', recordedAt: '2026-08-23T00:03:00.000Z',
        receipt: { operationId: 'update-a:update:0', sourceContactId: 'native-a' } },
    ],
  };
}

function withPhoto(workflow: CleanupWorkflow): CleanupWorkflow {
  const operation = workflow.writePlan?.operations[0];
  if (!operation || operation.kind !== 'update') throw new Error('Expected update fixture.');
  const photo = { uri: 'file:///authenticated-photo.jpg', hash: 'a'.repeat(64), assetId: 'photo-a' };
  return {
    ...workflow,
    writePlan: {
      ...workflow.writePlan!,
      operations: [{ id: 'create-photo', changeId: operation.changeId, kind: 'create',
        contact: { ...operation.after, photos: [photo] },
        reconciliationMarker: 'contactifier://write/fresh/create-photo' }],
      compensations: [{ kind: 'delete-created', operationId: 'create-photo' }],
      createCount: 1,
      updateCount: 0,
    },
    journal: [{ operationId: 'create-photo', outcome: 'applied', recordedAt: '2026-08-31T00:00:00.000Z',
      receipt: { operationId: 'create-photo', sourceContactId: 'native-photo' } }],
  };
}

describe('iOS certification report', () => {
  it('never certifies missing durable evidence', () => {
    const report = createIosCertificationReport({
      generatedAt: '2026-08-23T00:00:00.000Z',
      selectedVerifiedBackupId: 'backup',
      fixtureSetReady: true,
      workflows: [],
    });
    expect(report.certified).toBe(false);
    expect(report.items.every(({ status }) => status === 'pending')).toBe(true);
  });

  it('requires and recognizes separate durable Undo and rich-field evidence', () => {
    const report = createIosCertificationReport({
      generatedAt: '2026-08-23T00:00:00.000Z', selectedVerifiedBackupId: 'backup', fixtureSetReady: true,
      workflows: [
        completedWorkflow({ id: 'undo', changeSetId: 'parent:undo:transaction:original' }),
        completedWorkflow({ id: 'rich', changeSetId: 'backup:restore:rich', rich: true }),
      ],
    });
    expect(report.items.find(({ id }) => id === 'user-undo')?.status).toBe('passed');
    expect(report.items.find(({ id }) => id === 'rich-field-round-trip')?.status).toBe('passed');
    expect(report.certified).toBe(false);
  });

  it('does not certify partial rich-field coverage', () => {
    const partial = completedWorkflow({ id: 'partial-rich', changeSetId: 'backup:restore:partial' });
    const operation = partial.writePlan?.operations[0];
    if (!operation || operation.kind !== 'update') throw new Error('Expected update fixture.');
    const addressOnly = { ...operation.after, postalAddresses: [{ id: 'address', value: { city: 'Pune' }, origin: 'source' as const }] };
    const workflow: CleanupWorkflow = {
      ...partial,
      writePlan: { ...partial.writePlan!, operations: [{ ...operation, before: addressOnly, after: addressOnly }] },
    };
    const item = createIosCertificationReport({
      generatedAt: '2026-09-01T00:00:00.000Z', selectedVerifiedBackupId: 'backup',
      fixtureSetReady: true, workflows: [workflow],
    }).items.find(({ id }) => id === 'rich-field-round-trip');
    expect(item?.status).toBe('pending');
  });

  it('binds restore evidence to the exact selected verified backup', () => {
    const restore = completedWorkflow({ id: 'restore', changeSetId: 'fixture:restore:transaction' });
    const status = (selectedVerifiedBackupId: string) => createIosCertificationReport({
      generatedAt: '2026-08-23T00:00:00.000Z', selectedVerifiedBackupId,
      fixtureSetReady: true, workflows: [restore],
    }).items.find(({ id }) => id === 'backup-restore')?.status;
    expect(status('another-backup')).toBe('pending');
    expect(status('backup')).toBe('passed');
  });

  it('does not count an unowned normal contact workflow as simulator evidence', () => {
    const owned = completedWorkflow({ id: 'undo', changeSetId: 'parent:undo:transaction:original' });
    const operation = owned.writePlan?.operations[0];
    if (!operation || operation.kind !== 'update') throw new Error('Expected update fixture.');
    const withoutMarker = { ...operation.after, urls: [] };
    const unowned: CleanupWorkflow = {
      ...owned,
      writePlan: {
        ...owned.writePlan!,
        operations: [{ ...operation, before: withoutMarker, after: withoutMarker }],
      },
    };
    const item = createIosCertificationReport({
      generatedAt: '2026-08-23T00:00:00.000Z', selectedVerifiedBackupId: 'backup',
      fixtureSetReady: true, workflows: [unowned],
    }).items.find(({ id }) => id === 'user-undo');
    expect(item?.status).toBe('pending');
  });

  it('passes interruption evidence only after explicit reconciliation reaches a safe terminal state', () => {
    const base = completedWorkflow({ id: 'interruption', changeSetId: 'interruption' });
    const unresolved: CleanupWorkflow = {
      ...base, phase: 'failed', failure: { code: 'manual-review-required', recoverable: false, failedFrom: 'applying' },
      journal: [
        { operationId: 'update-a:update:0', outcome: 'started', recordedAt: '2026-08-23T00:02:00.000Z' },
        { operationId: 'update-a:update:0', outcome: 'ambiguous', origin: 'reconciliation', recordedAt: '2026-08-23T00:03:00.000Z' },
      ],
    };
    const resolved: CleanupWorkflow = {
      ...base, phase: 'rolled-back',
      journal: [
        { operationId: 'update-a:update:0', outcome: 'started', recordedAt: '2026-08-23T00:02:00.000Z' },
        { operationId: 'update-a:update:0', outcome: 'not-applied', origin: 'reconciliation', recordedAt: '2026-08-23T00:03:00.000Z' },
      ],
    };
    const status = (workflows: readonly CleanupWorkflow[]) => createIosCertificationReport({
      generatedAt: '2026-08-23T00:00:00.000Z', selectedVerifiedBackupId: 'backup', fixtureSetReady: true, workflows,
    }).items.find(({ id }) => id === 'write-interruption')?.status;
    expect(status([unresolved])).toBe('pending');
    expect(status([resolved])).toBe('passed');
  });

  it('does not confuse ordinary finalization with interruption recovery', () => {
    const base = completedWorkflow({ id: 'finalization', changeSetId: 'finalization' });
    const update = base.changeSet.changes[0];
    if (update.kind !== 'update') throw new Error('Expected update fixture.');
    const marker = 'contactifier://write/fresh/create-a';
    const withFinalization = (recovered: boolean): CleanupWorkflow => ({
      ...base,
      writePlan: {
        ...base.writePlan!,
        operations: [{ id: 'create-a', changeId: update.id, kind: 'create', contact: update.after,
          reconciliationMarker: marker }],
        compensations: [{ kind: 'delete-created', operationId: 'create-a' }],
        createCount: 1, updateCount: 0,
      },
      journal: [
        { operationId: 'create-a', outcome: 'started', recordedAt: '2026-08-23T00:01:00.000Z' },
        { operationId: 'create-a', outcome: 'applied', recordedAt: '2026-08-23T00:02:00.000Z',
          receipt: { operationId: 'create-a', sourceContactId: 'native-created' } },
        { operationId: 'create-a', outcome: 'finalization-started', recordedAt: '2026-08-23T00:03:00.000Z' },
        { operationId: 'create-a', outcome: 'finalized', recordedAt: '2026-08-23T00:04:00.000Z',
          origin: recovered ? 'recovery' : undefined,
          finalizationReceipt: { operationId: 'create-a', sourceContactId: 'native-created',
            removedReconciliationMarker: marker } },
      ],
    });
    const status = (workflow: CleanupWorkflow) => createIosCertificationReport({
      generatedAt: '2026-08-23T00:00:00.000Z', selectedVerifiedBackupId: 'backup',
      fixtureSetReady: true, workflows: [workflow],
    }).items.find(({ id }) => id === 'finalization-interruption')?.status;
    expect(status(withFinalization(false))).toBe('pending');
    expect(status(withFinalization(true))).toBe('passed');
  });

  it('requires verification-failure provenance for rollback certification', () => {
    const base = completedWorkflow({ id: 'rollback', changeSetId: 'rollback' });
    const operation = base.writePlan?.operations[0];
    if (!operation || operation.kind !== 'update') throw new Error('Expected update fixture.');
    const rolledBack = (rollbackCause: NonNullable<CleanupWorkflow['rollbackCause']>): CleanupWorkflow => ({
      ...base, phase: 'rolled-back', rollbackCause,
      journal: [
        { operationId: operation.id, outcome: 'started', recordedAt: '2026-08-23T00:01:00.000Z' },
        { operationId: operation.id, outcome: 'applied', recordedAt: '2026-08-23T00:02:00.000Z',
          receipt: { operationId: operation.id, sourceContactId: operation.sourceContactId } },
        { operationId: operation.id, outcome: 'compensated', recordedAt: '2026-08-23T00:03:00.000Z',
          compensationReceipt: { operationId: operation.id, kind: 'restore-update',
            restoredSourceContactId: operation.sourceContactId } },
      ],
    });
    const status = (workflow: CleanupWorkflow) => createIosCertificationReport({
      generatedAt: '2026-08-23T00:00:00.000Z', selectedVerifiedBackupId: 'backup',
      fixtureSetReady: true, workflows: [workflow],
    }).items.find(({ id }) => id === 'rollback')?.status;
    expect(status(rolledBack('write-rejected'))).toBe('pending');
    expect(status(rolledBack('verification-failed'))).toBe('passed');
  });

  it('binds permission denial proof to the selected backup and unchanged owned preflight', () => {
    const completed = completedWorkflow({ id: 'permission', changeSetId: 'permission' });
    const preflight: CleanupWorkflow = { ...completed, phase: 'preflighted', revision: 2, journal: [] };
    const evidence = {
      schemaVersion: 1 as const, scenario: 'permission-change' as const,
      workflowId: preflight.id, backupId: preflight.backupId,
      observedAt: '2026-08-31T00:00:00.000Z', denialReason: 'full-access-required' as const,
      revisionBefore: 2, revisionAfter: 2, journalEntriesBefore: 0, journalEntriesAfter: 0,
    };
    const status = (selectedVerifiedBackupId: string, workflow: CleanupWorkflow) =>
      createIosCertificationReport({
        generatedAt: '2026-08-31T00:01:00.000Z', selectedVerifiedBackupId,
        fixtureSetReady: true, workflows: [workflow], permissionEvidence: evidence,
      }).items.find(({ id }) => id === 'permission-change')?.status;
    expect(status('backup', preflight)).toBe('passed');
    expect(status('another-backup', preflight)).toBe('pending');
    expect(status('backup', { ...preflight, revision: 3 })).toBe('pending');
  });

  it('does not treat a planned photo reference as native byte-level round-trip proof', () => {
    const restore = withPhoto(completedWorkflow({
      id: 'photo-restore', changeSetId: 'backup:restore:photo',
    }));
    const item = createIosCertificationReport({
      generatedAt: '2026-08-31T00:00:00.000Z', selectedVerifiedBackupId: 'backup',
      fixtureSetReady: true, workflows: [restore],
    }).items.find(({ id }) => id === 'photo-round-trip');
    expect(item?.status).toBe('pending');
    expect(item?.evidence).toContain('SHA-256');
  });

  it('accepts byte-level photo proof only while it matches the exact completed workflow revision', () => {
    const restore = withPhoto(completedWorkflow({
      id: 'photo-restore', changeSetId: 'backup:restore:photo',
    }));
    const evidence = {
      schemaVersion: 1 as const, scenario: 'photo-round-trip' as const,
      workflowId: restore.id, workflowRevision: restore.revision, backupId: restore.backupId,
      operationId: 'create-photo', assetId: 'photo-a', nativeContactId: 'native-photo',
      expectedSha256: 'a'.repeat(64), actualSha256: 'a'.repeat(64),
      observedAt: '2026-08-31T00:00:00.000Z',
    };
    const status = (workflow: CleanupWorkflow) => createIosCertificationReport({
      generatedAt: '2026-08-31T00:01:00.000Z', selectedVerifiedBackupId: 'backup',
      fixtureSetReady: true, workflows: [workflow], photoEvidence: evidence,
    }).items.find(({ id }) => id === 'photo-round-trip')?.status;
    expect(status(restore)).toBe('passed');
    expect(status({ ...restore, revision: restore.revision + 1 })).toBe('pending');
  });
});
