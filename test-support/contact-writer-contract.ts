import {
  ContactWriteNotAppliedError,
  type ContactWriteReconciler,
  type ContactWriter,
  type ContactWriteVerifier,
} from '@/application';
import type {
  CanonicalContact,
  ContactWriteCompensation,
  ContactWriteOperation,
  ContactWritePlan,
} from '@/domain';

export type ContactWriterAdapter = ContactWriter & ContactWriteReconciler & ContactWriteVerifier;
export type ContactWriterAdapterFactory = (
  contacts: readonly CanonicalContact[],
) => ContactWriterAdapter;

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

function plan(
  operation: ContactWriteOperation,
  compensation: ContactWriteCompensation,
): ContactWritePlan {
  return {
    mode: 'dry-run',
    changeSetId: 'contract-changes',
    analyzedSnapshotId: 'contract-analyzed',
    freshSnapshotId: 'contract-fresh',
    backupId: 'contract-backup',
    plannedAt: '2026-08-20T10:00:00.000Z',
    operations: [operation],
    compensations: [compensation],
    createCount: operation.kind === 'create' ? 1 : 0,
    updateCount: operation.kind === 'update' ? 1 : 0,
    deleteCount: operation.kind === 'delete' ? 1 : 0,
  };
}

export function runContactWriterContract(
  adapterName: string,
  createAdapter: ContactWriterAdapterFactory,
): void {
  describe(`${adapterName} contact writer contract`, () => {
    it('creates, returns a stable receipt, verifies, reconciles, and compensates', async () => {
      const adapter = createAdapter([]);
      const created = contact('created');
      const operation: ContactWriteOperation = {
        id: 'create-1',
        changeId: 'change-1',
        kind: 'create',
        contact: created,
        reconciliationMarker: 'contactifier://write/contract/create-1',
      };
      const compensation: ContactWriteCompensation = {
        kind: 'delete-created',
        operationId: operation.id,
      };
      const receipt = await adapter.apply(operation);

      expect(receipt.operationId).toBe(operation.id);
      expect(receipt.sourceContactId).toBeTruthy();
      await expect(adapter.verify(plan(operation, compensation), [receipt])).resolves.toBe(true);
      await expect(adapter.reconcile(operation)).resolves.toMatchObject({ outcome: 'applied' });
      await expect(adapter.finalize(operation, receipt)).resolves.toEqual({
        operationId: operation.id,
        sourceContactId: receipt.sourceContactId,
        removedReconciliationMarker: operation.reconciliationMarker,
      });
      await expect(adapter.compensate(compensation, receipt)).resolves.toEqual({
        operationId: operation.id,
        kind: 'delete-created',
        deletedSourceContactId: receipt.sourceContactId,
      });
      await expect(adapter.reconcile(operation)).resolves.toEqual({ outcome: 'not-applied' });
    });

    it('updates and restores the exact before-state', async () => {
      const before = contact('a', 'Before');
      const after = contact('a', 'After');
      const adapter = createAdapter([before]);
      const operation: ContactWriteOperation = {
        id: 'update-1',
        changeId: 'change-1',
        kind: 'update',
        sourceContactId: before.recordRef.sourceContactId,
        before,
        after,
      };
      const compensation: ContactWriteCompensation = {
        kind: 'restore-update',
        operationId: operation.id,
        contact: before,
      };
      const receipt = await adapter.apply(operation);

      await expect(adapter.reconcile(operation)).resolves.toMatchObject({ outcome: 'applied' });
      await expect(adapter.compensate(compensation, receipt)).resolves.toEqual({
        operationId: operation.id,
        kind: 'restore-update',
        restoredSourceContactId: before.recordRef.sourceContactId,
      });
      await expect(adapter.reconcile(operation)).resolves.toEqual({ outcome: 'not-applied' });
    });

    it('deletes and recreates the exact before-state', async () => {
      const before = contact('a');
      const adapter = createAdapter([before]);
      const operation: ContactWriteOperation = {
        id: 'delete-1',
        changeId: 'change-1',
        kind: 'delete',
        sourceContactId: before.recordRef.sourceContactId,
        before,
      };
      const compensation: ContactWriteCompensation = {
        kind: 'recreate-deleted',
        operationId: operation.id,
        contact: before,
      };
      const receipt = await adapter.apply(operation);

      await expect(adapter.reconcile(operation)).resolves.toMatchObject({ outcome: 'applied' });
      const compensationReceipt = await adapter.compensate(compensation, receipt);
      expect(compensationReceipt).toMatchObject({
        operationId: operation.id,
        kind: 'recreate-deleted',
      });
      expect(
        compensationReceipt.kind === 'recreate-deleted' &&
          compensationReceipt.restoredSourceContactId,
      ).toBeTruthy();
      await expect(adapter.reconcile(operation)).resolves.toEqual({ outcome: 'not-applied' });
    });

    it('rejects a stale or missing target with a definitely-not-applied error', async () => {
      const before = contact('missing');
      const operation: ContactWriteOperation = {
        id: 'update-missing',
        changeId: 'change-1',
        kind: 'update',
        sourceContactId: before.recordRef.sourceContactId,
        before,
        after: contact('missing', 'After'),
      };

      await expect(createAdapter([]).apply(operation)).rejects.toBeInstanceOf(
        ContactWriteNotAppliedError,
      );
      await expect(createAdapter([contact('missing', 'External change')]).apply(operation)).rejects.toBeInstanceOf(
        ContactWriteNotAppliedError,
      );
    });

    it('fails verification when any operation receipt is absent', async () => {
      const before = contact('a');
      const operation: ContactWriteOperation = {
        id: 'delete-verify',
        changeId: 'change-1',
        kind: 'delete',
        sourceContactId: before.recordRef.sourceContactId,
        before,
      };
      const compensation: ContactWriteCompensation = {
        kind: 'recreate-deleted',
        operationId: operation.id,
        contact: before,
      };

      await expect(createAdapter([before]).verify(plan(operation, compensation), [])).resolves.toBe(
        false,
      );
    });
  });
}
