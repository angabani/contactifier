import {
  ContactWriteNotAppliedError,
  type ContactWriteReconciler,
  type ContactWriteReconciliation,
  type ContactWriter,
  type ContactWriteVerifier,
} from '@/application';
import { contactsSemanticallyEqual } from '@/domain';
import type {
  CanonicalContact,
  ContactWriteCompensation,
  ContactWriteCompensationReceipt,
  ContactWriteFinalizationReceipt,
  ContactWriteOperation,
  ContactWritePlan,
  ContactWriteReceipt,
} from '@/domain';

export interface SimulatedContactWriterOptions {
  readonly failBeforeOperationId?: string;
  readonly failBeforeCompensationOperationId?: string;
  readonly forceVerificationFailure?: boolean;
}

export class SimulatedContactWriter
  implements ContactWriter, ContactWriteReconciler, ContactWriteVerifier
{
  private readonly contactsBySourceId: Map<string, CanonicalContact>;

  constructor(
    contacts: readonly CanonicalContact[],
    private readonly options: SimulatedContactWriterOptions = {},
  ) {
    this.contactsBySourceId = new Map(
      contacts.map((contact) => [contact.recordRef.sourceContactId, contact]),
    );
  }

  async apply(operation: ContactWriteOperation): Promise<ContactWriteReceipt> {
    if (operation.id === this.options.failBeforeOperationId) {
      throw new ContactWriteNotAppliedError(`Injected failure before ${operation.id}.`);
    }
    if (operation.kind === 'create') {
      const sourceContactId = `simulated-${operation.id}`;
      this.contactsBySourceId.set(sourceContactId, {
        ...operation.contact,
        recordRef: { ...operation.contact.recordRef, sourceContactId },
      });
      return { operationId: operation.id, sourceContactId };
    }
    const current = this.contactsBySourceId.get(operation.sourceContactId);
    if (!current) {
      throw new ContactWriteNotAppliedError(`Contact ${operation.sourceContactId} is unavailable.`);
    }
    if (!contactsSemanticallyEqual(current, operation.before)) {
      throw new ContactWriteNotAppliedError(
        `Contact ${operation.sourceContactId} changed before the write.`,
      );
    }
    if (operation.kind === 'delete') {
      this.contactsBySourceId.delete(operation.sourceContactId);
    } else {
      this.contactsBySourceId.set(operation.sourceContactId, operation.after);
    }
    return { operationId: operation.id, sourceContactId: operation.sourceContactId };
  }

  async compensate(
    compensation: ContactWriteCompensation,
    receipt: ContactWriteReceipt,
  ): Promise<ContactWriteCompensationReceipt> {
    if (compensation.operationId === this.options.failBeforeCompensationOperationId) {
      throw new ContactWriteNotAppliedError(
        `Injected compensation failure before ${compensation.operationId}.`,
      );
    }
    if (compensation.kind === 'delete-created') {
      this.contactsBySourceId.delete(receipt.sourceContactId);
      return {
        operationId: compensation.operationId,
        kind: compensation.kind,
        deletedSourceContactId: receipt.sourceContactId,
      };
    }
    this.contactsBySourceId.set(
      compensation.contact.recordRef.sourceContactId,
      compensation.contact,
    );
    return {
      operationId: compensation.operationId,
      kind: compensation.kind,
      restoredSourceContactId: compensation.contact.recordRef.sourceContactId,
    };
  }

  async finalize(
    operation: Extract<ContactWriteOperation, { readonly kind: 'create' }>,
    receipt: ContactWriteReceipt,
  ): Promise<ContactWriteFinalizationReceipt> {
    if (!this.contactsBySourceId.has(receipt.sourceContactId)) {
      throw new ContactWriteNotAppliedError(`Contact ${receipt.sourceContactId} is unavailable.`);
    }
    return {
      operationId: operation.id,
      sourceContactId: receipt.sourceContactId,
      removedReconciliationMarker: operation.reconciliationMarker,
    };
  }

  verify(plan: ContactWritePlan, receipts: readonly ContactWriteReceipt[]): Promise<boolean> {
    if (this.options.forceVerificationFailure) return Promise.resolve(false);
    const receiptIds = new Set(receipts.map(({ operationId }) => operationId));
    if (!plan.operations.every(({ id }) => receiptIds.has(id))) return Promise.resolve(false);
    return Promise.resolve(
      plan.operations.every((operation) => {
        if (operation.kind === 'delete') return !this.contactsBySourceId.has(operation.sourceContactId);
        const sourceId =
          operation.kind === 'create'
            ? receipts.find(({ operationId }) => operationId === operation.id)?.sourceContactId
            : operation.sourceContactId;
        return !!sourceId && this.contactsBySourceId.has(sourceId);
      }),
    );
  }

  reconcile(operation: ContactWriteOperation): Promise<ContactWriteReconciliation> {
    if (operation.kind === 'create') {
      const sourceContactId = `simulated-${operation.id}`;
      return Promise.resolve(
        this.contactsBySourceId.has(sourceContactId)
          ? { outcome: 'applied', receipt: { operationId: operation.id, sourceContactId } }
          : { outcome: 'not-applied' },
      );
    }
    const current = this.contactsBySourceId.get(operation.sourceContactId);
    if (operation.kind === 'delete') {
      return Promise.resolve(
        current
          ? contactsSemanticallyEqual(current, operation.before)
            ? { outcome: 'not-applied' }
            : { outcome: 'ambiguous' }
          : {
              outcome: 'applied',
              receipt: { operationId: operation.id, sourceContactId: operation.sourceContactId },
            },
      );
    }
    if (current && contactsSemanticallyEqual(current, operation.after)) {
      return Promise.resolve({
        outcome: 'applied',
        receipt: { operationId: operation.id, sourceContactId: operation.sourceContactId },
      });
    }
    return Promise.resolve(
      current && contactsSemanticallyEqual(current, operation.before)
        ? { outcome: 'not-applied' }
        : { outcome: 'ambiguous' },
    );
  }

  contacts(): readonly CanonicalContact[] {
    return Object.freeze([...this.contactsBySourceId.values()]);
  }
}
