jest.mock('expo-contacts', () => ({
  Group: { getAll: jest.fn() },
}));

import {
  ExpoIosContactGroupMembershipReader,
  type ExpoContactGroup,
  type ExpoContactGroupApi,
} from '@/infrastructure/contacts/expo/expo-ios-contact-group-membership-reader';

function group(
  name: string | null,
  getContacts: ExpoContactGroup['getContacts'],
): ExpoContactGroup {
  return {
    id: name ?? 'unnamed',
    getName: jest.fn().mockResolvedValue(name),
    getContacts,
  };
}

describe('Expo iOS contact group membership reader', () => {
  it('pages memberships, excludes unrelated contacts, and normalizes group names', async () => {
    const firstBatch = Array.from({ length: 500 }, (_, index) => ({ id: `native-${index}` }));
    const familyContacts = jest.fn()
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce([{ id: 'native-500' }]);
    const api: ExpoContactGroupApi = {
      isSupported: () => true,
      getAll: jest.fn().mockResolvedValue([
        group(' Family ', familyContacts),
        group('Family', jest.fn().mockResolvedValue([{ id: 'native-500' }])),
        group('', jest.fn()),
      ]),
    };
    const requestedIds = new Set(['native-0', 'native-500']);

    const result = await new ExpoIosContactGroupMembershipReader(api)
      .readMemberships(requestedIds);

    expect(result).toEqual(new Map([
      ['native-0', ['Family']],
      ['native-500', ['Family']],
    ]));
    expect(familyContacts).toHaveBeenNthCalledWith(1, { limit: 500, offset: 0 });
    expect(familyContacts).toHaveBeenNthCalledWith(2, { limit: 500, offset: 500 });
  });

  it('does not call iOS group APIs on unsupported platforms', async () => {
    const api: ExpoContactGroupApi = {
      isSupported: () => false,
      getAll: jest.fn(),
    };

    await expect(
      new ExpoIosContactGroupMembershipReader(api).readMemberships(new Set(['native-1'])),
    ).resolves.toEqual(new Map());
    expect(api.getAll).not.toHaveBeenCalled();
  });
});
