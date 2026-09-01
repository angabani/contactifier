import * as SecureStore from 'expo-secure-store';
import {
  isIosPhotoRoundTripEvidence,
  type IosPhotoRoundTripEvidence,
} from '@/features/developer/ios-certification-photo-evidence';

const STORAGE_KEY = 'contactifier.ios-certification-photo-evidence.v1';
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export class ExpoIosPhotoEvidenceStore {
  async load(): Promise<IosPhotoRoundTripEvidence | null> {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY, options);
    if (!raw) return null;
    try {
      const value: unknown = JSON.parse(raw);
      return isIosPhotoRoundTripEvidence(value) ? Object.freeze(value) : null;
    } catch {
      return null;
    }
  }

  async save(evidence: IosPhotoRoundTripEvidence): Promise<void> {
    if (!isIosPhotoRoundTripEvidence(evidence)) throw new Error('Photo evidence is invalid.');
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(evidence), options);
  }
}
