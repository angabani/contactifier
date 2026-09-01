import * as SecureStore from 'expo-secure-store';

import {
  isIosPermissionDenialEvidence,
  type IosPermissionDenialEvidence,
} from '@/features/developer/ios-certification-permission-evidence';

const STORAGE_KEY = 'contactifier.ios-certification-permission-evidence.v1';
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export class ExpoIosCertificationEvidenceStore {
  async load(): Promise<IosPermissionDenialEvidence | null> {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY, options);
    if (!raw) return null;
    try {
      const value: unknown = JSON.parse(raw);
      return isIosPermissionDenialEvidence(value) ? Object.freeze(value) : null;
    } catch {
      return null;
    }
  }

  async save(evidence: IosPermissionDenialEvidence): Promise<void> {
    if (!isIosPermissionDenialEvidence(evidence)) throw new Error('Permission evidence is invalid.');
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(evidence), options);
  }
}
