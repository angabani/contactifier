import { Group } from 'expo-contacts';
import { Platform } from 'react-native';

export interface DeviceContactGroupMembershipReader {
  readMemberships(
    sourceContactIds: ReadonlySet<string>,
  ): Promise<ReadonlyMap<string, readonly string[]>>;
}

export interface ExpoContactGroup {
  readonly id: string;
  getName(): Promise<string | null>;
  getContacts(options: {
    readonly limit: number;
    readonly offset: number;
  }): Promise<readonly { readonly id: string }[]>;
}

export interface ExpoContactGroupApi {
  isSupported(): boolean;
  getAll(): Promise<readonly ExpoContactGroup[]>;
}

const GROUP_CONTACT_READ_BATCH_SIZE = 500;

const expoContactGroupApi: ExpoContactGroupApi = {
  isSupported: () => Platform.OS === 'ios',
  getAll: () => Group.getAll(),
};

/**
 * Reads iOS group membership as a separate boundary because Expo models groups
 * as container-owned entities rather than fields on a contact.
 */
export class ExpoIosContactGroupMembershipReader
  implements DeviceContactGroupMembershipReader
{
  constructor(private readonly api: ExpoContactGroupApi = expoContactGroupApi) {}

  async readMemberships(
    sourceContactIds: ReadonlySet<string>,
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    if (!this.api.isSupported() || sourceContactIds.size === 0) return new Map();

    const memberships = new Map<string, Set<string>>();
    const groups = await this.api.getAll();

    for (const group of groups) {
      const name = (await group.getName())?.trim();
      if (!name) continue;

      let offset = 0;
      while (true) {
        const contacts = await group.getContacts({
          limit: GROUP_CONTACT_READ_BATCH_SIZE,
          offset,
        });
        for (const contact of contacts) {
          if (!sourceContactIds.has(contact.id)) continue;
          const names = memberships.get(contact.id) ?? new Set<string>();
          names.add(name);
          memberships.set(contact.id, names);
        }
        if (contacts.length < GROUP_CONTACT_READ_BATCH_SIZE) break;
        offset += contacts.length;
      }
    }

    return new Map(
      [...memberships].map(([contactId, names]) => [
        contactId,
        [...names].sort((left, right) => left.localeCompare(right)),
      ]),
    );
  }
}
