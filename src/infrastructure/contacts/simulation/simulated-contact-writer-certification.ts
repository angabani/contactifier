import type { ContactWriterCertification } from '@/application';

export const SIMULATED_CONTACT_WRITER_ADAPTER_ID = 'contactifier.simulated-writer.v1';

export const simulatedContactWriterCertification: ContactWriterCertification = Object.freeze({
  adapterId: SIMULATED_CONTACT_WRITER_ADAPTER_ID,
  platform: 'simulation',
  contractVersion: 1,
  enabled: true,
  certifiedAt: '2026-08-20T00:00:00.000Z',
  evidence: Object.freeze({
    adapterContract: true,
    backupRestore: true,
    integrationTests: true,
    permissionHandling: true,
    postWriteVerification: true,
    reconciliation: true,
    rollback: true,
  }),
});
