import {
  Contact,
  getPermissionsAsync,
  type ContactPatch,
  type ContactsPermissionResponse,
  type CreateContactRecord,
} from 'expo-contacts';
import { Platform } from 'react-native';

import {
  ContactWriteNotAppliedError,
  type ContactWriteReconciler,
  type ContactWriteReconciliation,
  type ContactWriter,
  type ContactWriteVerifier,
} from '@/application';
import {
  contactsSemanticallyEqual,
  type CanonicalContact,
  type ContactSourceRef,
  type ContactWriteCompensation,
  type ContactWriteCompensationReceipt,
  type ContactWriteFinalizationReceipt,
  type ContactWriteOperation,
  type ContactWritePlan,
  type ContactWriteReceipt,
} from '@/domain';

import { DEVICE_CONTACT_FIELDS } from './device-contact-fields';
import {
  mapCanonicalContactToExpoCreate,
  mapCanonicalContactToExpoPatch,
} from './map-canonical-contact-to-expo';
import { mapExpoContact, type ExpoContactDetails } from './map-expo-contact';

export interface ExpoMutableContact {
  readonly id: string;
  getDetails(): Promise<ExpoContactDetails>;
  patch(value: ContactPatch): Promise<void>;
  delete(): Promise<void>;
}

export interface ExpoContactWriterApi {
  readonly platform: string;
  getPermissions(): Promise<ContactsPermissionResponse>;
  create(value: CreateContactRecord): Promise<ExpoMutableContact>;
  contact(id: string): ExpoMutableContact;
  getAllDetails(options: {
    readonly limit: number;
    readonly offset: number;
  }): Promise<readonly ExpoContactDetails[]>;
}

function mutableContact(contact: Contact): ExpoMutableContact {
  return {
    id: contact.id,
    getDetails: () => contact.getDetails(DEVICE_CONTACT_FIELDS),
    patch: (value) => contact.patch(value),
    delete: () => contact.delete(),
  };
}

const expoApi: ExpoContactWriterApi = {
  platform: Platform.OS,
  getPermissions: getPermissionsAsync,
  create: async (value) => mutableContact(await Contact.create(value)),
  contact: (id) => mutableContact(new Contact(id)),
  getAllDetails: (options) => Contact.getAllDetails(DEVICE_CONTACT_FIELDS, options),
};

const RECONCILIATION_BATCH_SIZE = 500;

export class ExpoIosContactWriter
  implements ContactWriter, ContactWriteReconciler, ContactWriteVerifier
{
  constructor(private readonly api: ExpoContactWriterApi = expoApi) {}

  async apply(operation: ContactWriteOperation): Promise<ContactWriteReceipt> {
    await this.assertWritable();
    if (operation.kind === 'create') {
      const created = await this.api.create(
        mapCanonicalContactToExpoCreate(operation.contact, operation.reconciliationMarker),
      );
      return { operationId: operation.id, sourceContactId: created.id };
    }
    const native = this.api.contact(operation.sourceContactId);
    const current = await this.read(native, operation.before.recordRef.source);
    if (!contactsSemanticallyEqual(current, operation.before)) {
      throw new ContactWriteNotAppliedError('The iOS contact changed after preflight.');
    }
    if (operation.kind === 'delete') await native.delete();
    else await native.patch(mapCanonicalContactToExpoPatch(operation.after));
    return { operationId: operation.id, sourceContactId: operation.sourceContactId };
  }

  async compensate(
    compensation: ContactWriteCompensation,
    receipt: ContactWriteReceipt,
  ): Promise<ContactWriteCompensationReceipt> {
    await this.assertWritable();
    if (compensation.kind === 'delete-created') {
      await this.api.contact(receipt.sourceContactId).delete();
      return {
        operationId: compensation.operationId,
        kind: compensation.kind,
        deletedSourceContactId: receipt.sourceContactId,
      };
    }
    if (compensation.kind === 'recreate-deleted') {
      const created = await this.api.create(mapCanonicalContactToExpoCreate(compensation.contact));
      return {
        operationId: compensation.operationId,
        kind: compensation.kind,
        restoredSourceContactId: created.id,
      };
    }
    await this.api
      .contact(receipt.sourceContactId)
      .patch(mapCanonicalContactToExpoPatch(compensation.contact));
    return {
      operationId: compensation.operationId,
      kind: compensation.kind,
      restoredSourceContactId: receipt.sourceContactId,
    };
  }

  async finalize(
    operation: Extract<ContactWriteOperation, { readonly kind: 'create' }>,
    receipt: ContactWriteReceipt,
  ): Promise<ContactWriteFinalizationReceipt> {
    await this.assertWritable();
    const native = this.api.contact(receipt.sourceContactId);
    const current = await this.read(native, operation.contact.recordRef.source);
    const withoutMarker = this.withoutMarker(current, operation.reconciliationMarker);
    if (!contactsSemanticallyEqual(withoutMarker, this.withSourceId(operation.contact, receipt.sourceContactId))) {
      throw new ContactWriteNotAppliedError('Created contact changed before marker finalization.');
    }
    if (current.urls.some(({ value }) => value === operation.reconciliationMarker)) {
      await native.patch(mapCanonicalContactToExpoPatch(operation.contact));
    }
    return {
      operationId: operation.id,
      sourceContactId: receipt.sourceContactId,
      removedReconciliationMarker: operation.reconciliationMarker,
    };
  }

  async reconcile(operation: ContactWriteOperation): Promise<ContactWriteReconciliation> {
    await this.assertWritable();
    if (operation.kind === 'create') return this.reconcileCreate(operation);
    let current: CanonicalContact;
    try {
      current = await this.read(
        this.api.contact(operation.sourceContactId),
        operation.before.recordRef.source,
      );
    } catch {
      return operation.kind === 'delete'
        ? {
            outcome: 'applied',
            receipt: { operationId: operation.id, sourceContactId: operation.sourceContactId },
          }
        : { outcome: 'ambiguous' };
    }
    if (contactsSemanticallyEqual(current, operation.before)) return { outcome: 'not-applied' };
    if (operation.kind === 'update' && contactsSemanticallyEqual(current, operation.after)) {
      return {
        outcome: 'applied',
        receipt: { operationId: operation.id, sourceContactId: operation.sourceContactId },
      };
    }
    return { outcome: 'ambiguous' };
  }

  async verify(
    plan: ContactWritePlan,
    receipts: readonly ContactWriteReceipt[],
  ): Promise<boolean> {
    if (receipts.length !== plan.operations.length) return false;
    const receiptByOperation = new Map(receipts.map((receipt) => [receipt.operationId, receipt]));
    for (const operation of plan.operations) {
      const receipt = receiptByOperation.get(operation.id);
      if (!receipt) return false;
      if (operation.kind === 'create') {
        try {
          const current = await this.read(
            this.api.contact(receipt.sourceContactId),
            operation.contact.recordRef.source,
          );
          if (
            !contactsSemanticallyEqual(
              this.withoutMarker(current, operation.reconciliationMarker),
              this.withSourceId(operation.contact, receipt.sourceContactId),
            )
          ) return false;
        } catch {
          return false;
        }
      } else if ((await this.reconcile(operation)).outcome !== 'applied') {
        return false;
      }
    }
    return true;
  }

  private async assertWritable(): Promise<void> {
    if (this.api.platform !== 'ios') {
      throw new ContactWriteNotAppliedError('iOS writer requires iOS.');
    }
    const permission = await this.api.getPermissions();
    if (!permission.granted || permission.accessPrivileges !== 'all') {
      throw new ContactWriteNotAppliedError('Full iOS contact access is required.');
    }
  }

  private async reconcileCreate(
    operation: Extract<ContactWriteOperation, { readonly kind: 'create' }>,
  ): Promise<ContactWriteReconciliation> {
    const matches: ExpoContactDetails[] = [];
    let offset = 0;
    while (true) {
      const batch = await this.api.getAllDetails({ limit: RECONCILIATION_BATCH_SIZE, offset });
      matches.push(
        ...batch.filter(({ urlAddresses }) =>
          urlAddresses?.some(({ url }) => url === operation.reconciliationMarker),
        ),
      );
      if (matches.length > 1) return { outcome: 'ambiguous' };
      if (batch.length < RECONCILIATION_BATCH_SIZE) break;
      offset += batch.length;
    }
    const match = matches[0];
    if (!match) return { outcome: 'not-applied' };
    const current = this.withoutMarker(
      mapExpoContact(match, operation.contact.recordRef.source),
      operation.reconciliationMarker,
    );
    if (!contactsSemanticallyEqual(current, this.withSourceId(operation.contact, match.id))) {
      return { outcome: 'ambiguous' };
    }
    return {
      outcome: 'applied',
      receipt: { operationId: operation.id, sourceContactId: match.id },
    };
  }

  private async read(contact: ExpoMutableContact, source: ContactSourceRef): Promise<CanonicalContact> {
    try {
      return mapExpoContact(await contact.getDetails(), source);
    } catch {
      throw new ContactWriteNotAppliedError(`Contact ${contact.id} is unavailable.`);
    }
  }

  private withSourceId(contact: CanonicalContact, sourceContactId: string): CanonicalContact {
    return { ...contact, recordRef: { ...contact.recordRef, sourceContactId } };
  }

  private withoutMarker(contact: CanonicalContact, marker: string): CanonicalContact {
    return { ...contact, urls: contact.urls.filter(({ value }) => value !== marker) };
  }
}
