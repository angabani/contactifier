import * as SecureStore from 'expo-secure-store';

import {
  defaultContactConfirmationPreferences,
  type ContactConfirmationPreferenceRepository,
  type ContactConfirmationPreferences,
} from '@/application';

const STORAGE_KEY = 'contactifier.confirmation-preferences.v1';
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function validated(value: unknown): ContactConfirmationPreferences {
  if (!value || typeof value !== 'object') return defaultContactConfirmationPreferences;
  const candidate = value as Partial<ContactConfirmationPreferences>;
  return Object.freeze({
    merge: typeof candidate.merge === 'boolean' ? candidate.merge : true,
    update: typeof candidate.update === 'boolean' ? candidate.update : true,
    delete: typeof candidate.delete === 'boolean' ? candidate.delete : true,
    restore: typeof candidate.restore === 'boolean' ? candidate.restore : true,
    undo: typeof candidate.undo === 'boolean' ? candidate.undo : true,
  });
}

export class ExpoContactConfirmationPreferenceRepository
implements ContactConfirmationPreferenceRepository {
  async load(): Promise<ContactConfirmationPreferences> {
    if (!(await SecureStore.isAvailableAsync())) return defaultContactConfirmationPreferences;
    const raw = await SecureStore.getItemAsync(STORAGE_KEY, options);
    if (!raw) return defaultContactConfirmationPreferences;
    try {
      return validated(JSON.parse(raw));
    } catch {
      return defaultContactConfirmationPreferences;
    }
  }

  async save(value: ContactConfirmationPreferences): Promise<void> {
    if (!(await SecureStore.isAvailableAsync())) {
      throw new Error('Confirmation preferences are unavailable on this device.');
    }
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(validated(value)), options);
  }

  async reset(): Promise<void> {
    if (await SecureStore.isAvailableAsync()) {
      await SecureStore.deleteItemAsync(STORAGE_KEY, options);
    }
  }
}
