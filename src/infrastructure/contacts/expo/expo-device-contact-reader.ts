import {
  Contact,
  getPermissionsAsync,
  requestPermissionsAsync,
  type ContactsPermissionResponse,
} from 'expo-contacts';

import {
  ContactPermissionDeniedError,
  type ContactReader,
  type ContactReadResult,
} from '@/application';
import { assertDomain, type ContactSourceRef } from '@/domain';

import { DEVICE_CONTACT_FIELDS } from './device-contact-fields';
import { mapExpoContact, type ExpoContactDetails } from './map-expo-contact';

export interface DeviceContactsApi {
  getPermissions(): Promise<ContactsPermissionResponse>;
  requestPermissions(): Promise<ContactsPermissionResponse>;
  getAllDetails(options: {
    readonly limit: number;
    readonly offset: number;
  }): Promise<readonly ExpoContactDetails[]>;
}

const CONTACT_READ_BATCH_SIZE = 500;

const expoContactsApi: DeviceContactsApi = {
  getPermissions: getPermissionsAsync,
  requestPermissions: requestPermissionsAsync,
  getAllDetails: (options) => Contact.getAllDetails(DEVICE_CONTACT_FIELDS, options),
};

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

    const contacts: ExpoContactDetails[] = [];
    let offset = 0;
    while (true) {
      const batch = await this.api.getAllDetails({
        limit: CONTACT_READ_BATCH_SIZE,
        offset,
      });
      contacts.push(...batch);
      if (batch.length < CONTACT_READ_BATCH_SIZE) break;
      offset += batch.length;
    }
    return {
      contacts: contacts.map((contact) => mapExpoContact(contact, source)),
      accessScope: permission.accessPrivileges === 'limited' ? 'limited' : 'all',
    };
  }
}
