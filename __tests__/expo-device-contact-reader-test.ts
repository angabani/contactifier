import { PermissionStatus } from 'expo';
import type { ContactsPermissionResponse } from 'expo-contacts';

jest.mock('expo-contacts', () => ({
  Contact: { getAllDetails: jest.fn() },
  ContactField: {
    FULL_NAME: 'fullName',
    GIVEN_NAME: 'givenName',
    MIDDLE_NAME: 'middleName',
    FAMILY_NAME: 'familyName',
    NICKNAME: 'nickname',
    PREFIX: 'prefix',
    SUFFIX: 'suffix',
    PHONETIC_GIVEN_NAME: 'phoneticGivenName',
    PHONETIC_MIDDLE_NAME: 'phoneticMiddleName',
    PHONETIC_FAMILY_NAME: 'phoneticFamilyName',
    COMPANY: 'company',
    DEPARTMENT: 'department',
    JOB_TITLE: 'jobTitle',
    IMAGE: 'image',
    THUMBNAIL: 'thumbnail',
    BIRTHDAY: 'birthday',
    EMAILS: 'emails',
    PHONES: 'phones',
    ADDRESSES: 'addresses',
    EXTRA_NAMES: 'extraNames',
    DATES: 'dates',
    URL_ADDRESSES: 'urlAddresses',
  },
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
}));

import type {
  DeviceContactGroupMembershipReader,
  DeviceContactsApi,
  ExpoContactDetails,
} from '@/infrastructure/contacts/expo';
import { ContactPermissionDeniedError } from '@/application';
import {
  ExpoDeviceContactReader,
  mapExpoContact,
} from '@/infrastructure/contacts/expo';

function permission(
  granted: boolean,
  canAskAgain: boolean,
): ContactsPermissionResponse {
  return {
    granted,
    canAskAgain,
    expires: 'never',
    status: granted ? PermissionStatus.GRANTED : PermissionStatus.DENIED,
    accessPrivileges: granted ? 'all' : 'none',
  };
}

function expoContact(overrides: Partial<ExpoContactDetails> = {}): ExpoContactDetails {
  return {
    id: 'native-1',
    fullName: 'Ada Lovelace',
    givenName: 'Ada',
    middleName: null,
    familyName: 'Lovelace',
    nickname: 'Enchantress of Numbers',
    prefix: null,
    suffix: null,
    phoneticGivenName: null,
    phoneticMiddleName: null,
    phoneticFamilyName: null,
    company: 'Analytical Engines',
    department: 'Research',
    jobTitle: 'Mathematician',
    image: null,
    thumbnail: 'file:///ada-thumbnail.jpg',
    birthday: { month: 12, day: 10, year: 1815 },
    emails: [{ id: 'email-1', label: 'work', address: 'ada@example.com' }],
    phones: [{ id: 'phone-1', label: 'mobile', number: '+44 1234' }],
    addresses: [
      {
        id: 'address-1',
        label: 'home',
        street: '1 Computing Lane',
        city: 'London',
        postcode: 'N1',
        country: 'United Kingdom',
      },
    ],
    extraNames: [],
    dates: [
      { id: 'date-1', label: 'anniversary', date: { month: 7, day: 5 } },
    ],
    urlAddresses: [{ id: 'url-1', label: 'website', url: 'https://example.com' }],
    ...overrides,
  };
}

describe('Expo device contacts infrastructure', () => {
  it('maps native details into a canonical contact without changing source data', () => {
    const source = { kind: 'device' as const, containerId: 'personal' };
    const result = mapExpoContact(expoContact(), source);

    expect(result.id).toBe('device:personal:native-1');
    expect(result.recordRef).toEqual({ source, sourceContactId: 'native-1' });
    expect(result.name).toMatchObject({ givenName: 'Ada', familyName: 'Lovelace' });
    expect(result.phoneNumbers[0]).toMatchObject({
      id: 'phone-1',
      value: { raw: '+44 1234' },
      origin: 'source',
    });
    expect(result.emailAddresses[0].value).toBe('ada@example.com');
    expect(result.birthdays[0].value).toEqual({ month: 12, day: 10, year: 1815 });
    expect(result.events[0].value.date).toEqual({ month: 7, day: 5 });
    expect(result.photos).toEqual([{
      uri: 'file:///ada-thumbnail.jpg',
      assetId: 'device:personal:native-1:photo:0',
    }]);
    expect(result.notes).toEqual([]);
  });

  it('accepts platform-specific collections omitted by the native result', () => {
    const nativeContact = {
      ...expoContact(),
      extraNames: undefined,
      dates: undefined,
      urlAddresses: undefined,
    } as unknown as ExpoContactDetails;

    const result = mapExpoContact(nativeContact, { kind: 'device' });

    expect(result.nicknames).toHaveLength(1);
    expect(result.events).toEqual([]);
    expect(result.urls).toEqual([]);
  });

  it('normalizes native yearless date sentinels and omits only malformed dates', () => {
    const result = mapExpoContact(expoContact({
      birthday: { month: 2, day: 29, year: Number.NaN },
      dates: [
        { id: 'valid-yearless', label: 'anniversary', date: { month: 5, day: 4, year: 0 } },
        { id: 'invalid-date', label: 'legacy', date: { month: 13, day: 40, year: 2020 } },
      ],
    }), { kind: 'device' });

    expect(result.birthdays[0].value).toEqual({ month: 2, day: 29 });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].value.date).toEqual({ month: 5, day: 4 });
  });

  it('does not turn an empty native contact into a synthetic name', () => {
    const result = mapExpoContact(
      expoContact({ fullName: null, givenName: null, familyName: null, company: null }),
      { kind: 'device' },
    );
    expect(result.displayName).toBe('');
    expect(result.name).toBeUndefined();
  });

  it('requests permission when it can still ask, then reads contacts', async () => {
    const api: DeviceContactsApi = {
      getPermissions: jest.fn().mockResolvedValue(permission(false, true)),
      requestPermissions: jest.fn().mockResolvedValue(permission(true, true)),
      getAllDetails: jest.fn().mockResolvedValue([expoContact()]),
    };

    const result = await new ExpoDeviceContactReader(api).readContacts({ kind: 'device' });

    expect(api.requestPermissions).toHaveBeenCalledTimes(1);
    expect(api.getAllDetails).toHaveBeenCalledTimes(1);
    expect(result.contacts).toHaveLength(1);
  });

  it('reads large directories through bounded native batches', async () => {
    const firstBatch = Array.from({ length: 500 }, (_, index) =>
      expoContact({ id: `native-${index}` }),
    );
    const getAllDetails = jest
      .fn()
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce([expoContact({ id: 'native-500' })]);
    const api: DeviceContactsApi = {
      getPermissions: jest.fn().mockResolvedValue(permission(true, true)),
      requestPermissions: jest.fn(),
      getAllDetails,
    };

    const result = await new ExpoDeviceContactReader(api).readContacts({ kind: 'device' });

    expect(result.contacts).toHaveLength(501);
    expect(getAllDetails).toHaveBeenNthCalledWith(1, { limit: 500, offset: 0 });
    expect(getAllDetails).toHaveBeenNthCalledWith(2, { limit: 500, offset: 500 });
  });

  it('supports limited iOS access when the permission is granted', async () => {
    const limitedPermission = { ...permission(true, true), accessPrivileges: 'limited' as const };
    const api: DeviceContactsApi = {
      getPermissions: jest.fn().mockResolvedValue(limitedPermission),
      requestPermissions: jest.fn(),
      getAllDetails: jest.fn().mockResolvedValue([expoContact()]),
    };

    const groupMembershipReader: DeviceContactGroupMembershipReader = {
      readMemberships: jest.fn(),
    };

    await expect(
      new ExpoDeviceContactReader(api, groupMembershipReader).readContacts({ kind: 'device' }),
    ).resolves.toMatchObject({ contacts: [{ displayName: 'Ada Lovelace' }] });
    expect(api.requestPermissions).not.toHaveBeenCalled();
    expect(groupMembershipReader.readMemberships).not.toHaveBeenCalled();
  });

  it('enriches full-access contacts with memberships keyed by native contact id', async () => {
    const api: DeviceContactsApi = {
      getPermissions: jest.fn().mockResolvedValue(permission(true, true)),
      requestPermissions: jest.fn(),
      getAllDetails: jest.fn().mockResolvedValue([
        expoContact({ id: 'native-1' }),
        expoContact({ id: 'native-2' }),
      ]),
    };
    const groupMembershipReader: DeviceContactGroupMembershipReader = {
      readMemberships: jest.fn().mockResolvedValue(new Map([
        ['native-1', ['Family', 'VIP']],
      ])),
    };

    const result = await new ExpoDeviceContactReader(api, groupMembershipReader)
      .readContacts({ kind: 'device' });

    expect(groupMembershipReader.readMemberships).toHaveBeenCalledWith(
      new Set(['native-1', 'native-2']),
    );
    expect(result.contacts.map(({ groups }) => groups)).toEqual([
      ['Family', 'VIP'],
      [],
    ]);
  });

  it('fails a full-access scan when group membership cannot be read safely', async () => {
    const api: DeviceContactsApi = {
      getPermissions: jest.fn().mockResolvedValue(permission(true, true)),
      requestPermissions: jest.fn(),
      getAllDetails: jest.fn().mockResolvedValue([expoContact()]),
    };
    const groupMembershipReader: DeviceContactGroupMembershipReader = {
      readMemberships: jest.fn().mockRejectedValue(new Error('Native group query failed')),
    };

    await expect(
      new ExpoDeviceContactReader(api, groupMembershipReader).readContacts({ kind: 'device' }),
    ).rejects.toThrow('Native group query failed');
  });

  it('does not reopen the prompt after a final denial', async () => {
    const api: DeviceContactsApi = {
      getPermissions: jest.fn().mockResolvedValue(permission(false, false)),
      requestPermissions: jest.fn(),
      getAllDetails: jest.fn(),
    };

    await expect(
      new ExpoDeviceContactReader(api).readContacts({ kind: 'device' }),
    ).rejects.toEqual(new ContactPermissionDeniedError(false));
    expect(api.requestPermissions).not.toHaveBeenCalled();
    expect(api.getAllDetails).not.toHaveBeenCalled();
  });
});
