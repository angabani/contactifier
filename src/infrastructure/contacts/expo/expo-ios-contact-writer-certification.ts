import type { ContactWriterCertification } from '@/application';

export const EXPO_IOS_CONTACT_WRITER_ADAPTER_ID = 'contactifier.expo-ios-writer.v1';

export const expoIosContactWriterCertification: ContactWriterCertification = Object.freeze({
  adapterId: EXPO_IOS_CONTACT_WRITER_ADAPTER_ID,
  platform: 'ios',
  contractVersion: 1,
  enabled: false,
  certifiedAt: '2026-08-20T00:00:00.000Z',
  evidence: Object.freeze({
    adapterContract: false,
    backupRestore: false,
    integrationTests: false,
    permissionHandling: false,
    postWriteVerification: false,
    reconciliation: false,
    rollback: false,
  }),
});
