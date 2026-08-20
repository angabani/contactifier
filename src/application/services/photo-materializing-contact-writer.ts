import type {
  BackupManifest,
  ContactWriteCompensation,
  ContactWriteCompensationReceipt,
  ContactWriteFinalizationReceipt,
  ContactWriteOperation,
  ContactWriteReceipt,
} from '@/domain';

import type { ContactWriter } from '../ports/contact-writer';
import { WithMaterializedContactPhotos } from '../use-cases/with-materialized-contact-photos';

export class PhotoMaterializingContactWriter implements ContactWriter {
  constructor(
    private readonly writer: ContactWriter,
    private readonly photos: WithMaterializedContactPhotos,
    private readonly backup: BackupManifest,
  ) {}

  apply(operation: ContactWriteOperation): Promise<ContactWriteReceipt> {
    if (operation.kind !== 'create' || operation.contact.photos.length === 0) {
      return this.writer.apply(operation);
    }
    return this.photos.execute(this.backup, [operation.contact], async ([contact]) => {
      if (!contact) throw new Error('Materialized create contact is unavailable.');
      return this.writer.apply({ ...operation, contact });
    });
  }

  compensate(
    compensation: ContactWriteCompensation,
    receipt: ContactWriteReceipt,
  ): Promise<ContactWriteCompensationReceipt> {
    if (compensation.kind !== 'recreate-deleted' || compensation.contact.photos.length === 0) {
      return this.writer.compensate(compensation, receipt);
    }
    return this.photos.execute(this.backup, [compensation.contact], async ([contact]) => {
      if (!contact) throw new Error('Materialized compensation contact is unavailable.');
      return this.writer.compensate({ ...compensation, contact }, receipt);
    });
  }

  finalize(
    operation: Extract<ContactWriteOperation, { readonly kind: 'create' }>,
    receipt: ContactWriteReceipt,
  ): Promise<ContactWriteFinalizationReceipt> {
    return this.writer.finalize(operation, receipt);
  }
}
