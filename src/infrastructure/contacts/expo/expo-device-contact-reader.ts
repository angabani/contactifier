import {
  Contact,
  getPermissionsAsync,
  requestPermissionsAsync,
  type ContactsPermissionResponse,
} from 'expo-contacts';

import type { ContactReader, ContactReadResult } from '@/application';
import { assertDomain, type ContactSourceRef } from '@/domain';

import { DEVICE_CONTACT_FIELDS } from './device-contact-fields';
import { mapExpoContact, type ExpoContactDetails } from './map-expo-contact';

export interface DeviceContactsApi {
  getPermissions(): Promise<ContactsPermissionResponse>;
  requestPermissions(): Promise<ContactsPermissionResponse>;
  getAllDetails(): Promise<readonly ExpoContactDetails[]>;
}

const expoContactsApi: DeviceContactsApi = {
  getPermissions: getPermissionsAsync,
  requestPermissions: requestPermissionsAsync,
  getAllDetails: () => Contact.getAllDetails(DEVICE_CONTACT_FIELDS),
};

export class ContactPermissionDeniedError extends Error {
  constructor(readonly canAskAgain: boolean) {
    super('Permission to read device contacts was denied.');
    this.name = 'ContactPermissionDeniedError';
  }
}

export class ExpoDeviceContactReader implements ContactReader {
  constructor(private readonly api: DeviceContactsApi = expoContactsApi) {}

  async readContacts(source: ContactSourceRef): Promise<ContactReadResult> {
    assertDomain(source.kind === 'device', 'Expo device reader requires a device contact source.');

    let permission = await this.api.getPermissions();
    if (!permission.granted && permission.canAskAgain) {
      permission = await this.api.requestPermissions();
    }
    if (!permission.granted) {
      throw new ContactPermissionDeniedError(permission.canAskAgain);
    }

    const contacts = await this.api.getAllDetails();
    return { contacts: contacts.map((contact) => mapExpoContact(contact, source)) };
  }
}
