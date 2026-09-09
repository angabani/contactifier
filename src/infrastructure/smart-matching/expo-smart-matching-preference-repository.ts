import * as SecureStore from 'expo-secure-store';

import type {
  SmartMatchingConsent,
  SmartMatchingPreferenceRepository,
} from '@/application';

const STORAGE_KEY = 'contactifier.smart-matching-consent.v1';
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export class ExpoSmartMatchingPreferenceRepository
implements SmartMatchingPreferenceRepository {
  async load(): Promise<SmartMatchingConsent> {
    if (!(await SecureStore.isAvailableAsync())) return 'undecided';
    const value = await SecureStore.getItemAsync(STORAGE_KEY, options);
    return value === 'enabled' || value === 'disabled' ? value : 'undecided';
  }

  async save(value: SmartMatchingConsent): Promise<void> {
    if (!(await SecureStore.isAvailableAsync())) {
      throw new Error('Smart matching preferences are unavailable on this device.');
    }
    await SecureStore.setItemAsync(STORAGE_KEY, value, options);
  }
}
