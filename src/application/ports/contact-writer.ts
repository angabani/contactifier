import type {
  ContactWriteCompensation,
  ContactWriteCompensationReceipt,
  ContactWriteFinalizationReceipt,
  ContactWriteOperation,
  ContactWritePlan,
  ContactWriteReceipt,
} from '@/domain';

export class ContactWriteNotAppliedError extends Error {
  constructor(message = 'The contact write was rejected before any mutation occurred.') {
    super(message);
    this.name = 'ContactWriteNotAppliedError';
  }
}

export interface ContactWriter {
  apply(operation: ContactWriteOperation): Promise<ContactWriteReceipt>;
  compensate(
    compensation: ContactWriteCompensation,
    receipt: ContactWriteReceipt,
  ): Promise<ContactWriteCompensationReceipt>;
  finalize(
    operation: Extract<ContactWriteOperation, { readonly kind: 'create' }>,
    receipt: ContactWriteReceipt,
  ): Promise<ContactWriteFinalizationReceipt>;
}

export interface ContactWriteVerifier {
  verify(
    plan: ContactWritePlan,
    receipts: readonly ContactWriteReceipt[],
  ): Promise<boolean>;
}

export type ContactWriteReconciliation =
  | { readonly outcome: 'ambiguous' }
  | { readonly outcome: 'applied'; readonly receipt: ContactWriteReceipt }
  | { readonly outcome: 'not-applied' };

export interface ContactWriteReconciler {
  reconcile(operation: ContactWriteOperation): Promise<ContactWriteReconciliation>;
}
