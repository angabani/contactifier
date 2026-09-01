jest.mock('expo-contacts', () => ({
  Contact: class MockContact {},
  Group: { getAll: jest.fn() },
}));

import { ContactWriteNotAppliedError } from '@/application';
import {
  ExpoIosContactGroupMembershipWriter,
  type ExpoContactGroupMutationApi,
  type ExpoMutableContactGroup,
} from '@/infrastructure/contacts/expo/expo-ios-contact-group-membership-writer';

function group(name: string, members: readonly string[] = []): ExpoMutableContactGroup {
  return {
    id: `group-${name}`,
    getName: jest.fn().mockResolvedValue(name),
    getContacts: jest.fn().mockResolvedValue(members.map((id) => ({ id }))),
    addContact: jest.fn().mockResolvedValue(undefined),
    removeContact: jest.fn().mockResolvedValue(undefined),
  };
}

function api(groups: readonly ExpoMutableContactGroup[]): ExpoContactGroupMutationApi {
  return { platform: 'ios', getAll: jest.fn().mockResolvedValue(groups) };
}

describe('Expo iOS contact group membership writer', () => {
  it('applies only the required removals and additions', async () => {
    const family = group('Family', ['native-1']);
    const vip = group('VIP');

    await new ExpoIosContactGroupMembershipWriter(api([family, vip]))
      .synchronize('native-1', ['Family'], ['VIP']);

    expect(family.removeContact).toHaveBeenCalledWith('native-1');
    expect(vip.addContact).toHaveBeenCalledWith('native-1');
  });

  it('rejects stale membership before any mutation', async () => {
    const family = group('Family');
    const vip = group('VIP');

    await expect(
      new ExpoIosContactGroupMembershipWriter(api([family, vip]))
        .synchronize('native-1', ['Family'], ['VIP']),
    ).rejects.toBeInstanceOf(ContactWriteNotAppliedError);
    expect(family.removeContact).not.toHaveBeenCalled();
    expect(vip.addContact).not.toHaveBeenCalled();
  });

  it('rejects missing and container-ambiguous groups before mutation', async () => {
    const first = group('VIP');
    const second = group('VIP');

    await expect(
      new ExpoIosContactGroupMembershipWriter(api([first]))
        .synchronize('native-1', [], ['Missing']),
    ).rejects.toThrow('does not exist');
    await expect(
      new ExpoIosContactGroupMembershipWriter(api([first, second]))
        .synchronize('native-1', [], ['VIP']),
    ).rejects.toThrow('ambiguous');
    expect(first.addContact).not.toHaveBeenCalled();
    expect(second.addContact).not.toHaveBeenCalled();
  });

  it('compensates earlier membership changes when a later native write fails', async () => {
    const family = group('Family', ['native-1']);
    const vip = group('VIP');
    (vip.addContact as jest.Mock).mockRejectedValue(new Error('Native add failed'));

    await expect(
      new ExpoIosContactGroupMembershipWriter(api([family, vip]))
        .synchronize('native-1', ['Family'], ['VIP']),
    ).rejects.toBeInstanceOf(ContactWriteNotAppliedError);
    expect(family.removeContact).toHaveBeenCalledWith('native-1');
    expect(family.addContact).toHaveBeenCalledWith('native-1');
  });

  it('reports an unknown outcome when membership compensation also fails', async () => {
    const family = group('Family', ['native-1']);
    const vip = group('VIP');
    (vip.addContact as jest.Mock).mockRejectedValue(new Error('Native add failed'));
    (family.addContact as jest.Mock).mockRejectedValue(new Error('Native compensation failed'));

    await expect(
      new ExpoIosContactGroupMembershipWriter(api([family, vip]))
        .synchronize('native-1', ['Family'], ['VIP']),
    ).rejects.toThrow('outcome is unknown');
  });
});
