import { Contact, getPermissionsAsync, type CreateContactRecord } from 'expo-contacts';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type {
  IosFixtureCandidate,
  IosFixtureGateway,
  IosFixtureRepository,
  IosFixtureSet,
  IosFixtureSpec,
} from '@/features/developer/ios-certification-fixtures';

import { DEVICE_CONTACT_FIELDS } from './device-contact-fields';
import type { ExpoContactDetails } from './map-expo-contact';

const STORAGE_KEY = 'contactifier.ios-certification-fixtures.v1';
const BATCH_SIZE = 500;
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function candidate(contact: ExpoContactDetails): IosFixtureCandidate {
  return {
    id: contact.id,
    givenName: contact.givenName ?? undefined,
    markerValues: (contact.urlAddresses ?? []).flatMap((value) => value.url ? [value.url] : []),
  };
}

async function assertWritable(): Promise<void> {
  if (!__DEV__ || Platform.OS !== 'ios') throw new Error('Certification fixtures require a development iOS build.');
  const permission = await getPermissionsAsync();
  if (!permission.granted || permission.accessPrivileges !== 'all') throw new Error('Full contact access is required.');
}

export class ExpoIosCertificationFixtureRepository implements IosFixtureRepository {
  async load(): Promise<IosFixtureSet | null> {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY, options);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || (value as { schemaVersion?: unknown }).schemaVersion !== 1) {
      throw new Error('Certification fixture metadata is invalid.');
    }
    return value as IosFixtureSet;
  }

  async save(value: IosFixtureSet): Promise<void> {
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(value), options);
  }

  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(STORAGE_KEY, options);
  }
}

export class ExpoIosCertificationFixtureGateway implements IosFixtureGateway {
  async create(spec: IosFixtureSpec): Promise<string> {
    await assertWritable();
    const value: CreateContactRecord = {
      givenName: spec.givenName,
      familyName: spec.familyName,
      phones: [{ label: 'mobile', number: spec.phone }],
      emails: [{ label: 'home', address: spec.email }],
      urlAddresses: [{ label: 'Contactifier ownership', url: spec.marker }],
    };
    return (await Contact.create(value)).id;
  }

  async findByMarker(marker: string): Promise<readonly IosFixtureCandidate[]> {
    await assertWritable();
    const matches: IosFixtureCandidate[] = [];
    let offset = 0;
    while (true) {
      const batch = await Contact.getAllDetails(DEVICE_CONTACT_FIELDS, { limit: BATCH_SIZE, offset });
      matches.push(...batch.map(candidate).filter(({ markerValues }) => markerValues.includes(marker)));
      if (batch.length < BATCH_SIZE) return matches;
      offset += batch.length;
    }
  }

  async deleteIfOwned(input: { readonly id: string; readonly marker: string; readonly expectedGivenName: string }): Promise<boolean> {
    await assertWritable();
    const native = new Contact(input.id);
    const current = candidate(await native.getDetails(DEVICE_CONTACT_FIELDS));
    if (current.givenName !== input.expectedGivenName || !current.markerValues.includes(input.marker)) return false;
    await native.delete();
    return true;
  }
}
