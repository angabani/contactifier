import { Contact, Group } from 'expo-contacts';
import { Platform } from 'react-native';

import { ContactWriteNotAppliedError } from '@/application';

export interface ExpoMutableContactGroup {
  readonly id: string;
  getName(): Promise<string | null>;
  getContacts(): Promise<readonly { readonly id: string }[]>;
  addContact(sourceContactId: string): Promise<void>;
  removeContact(sourceContactId: string): Promise<void>;
}

export interface ExpoContactGroupMutationApi {
  readonly platform: string;
  getAll(): Promise<readonly ExpoMutableContactGroup[]>;
}

function mutableGroup(group: Group): ExpoMutableContactGroup {
  return {
    id: group.id,
    getName: () => group.getName(),
    getContacts: () => group.getContacts(),
    addContact: (sourceContactId) => group.addContact(new Contact(sourceContactId)),
    removeContact: (sourceContactId) => group.removeContact(new Contact(sourceContactId)),
  };
}

const expoGroupMutationApi: ExpoContactGroupMutationApi = {
  platform: Platform.OS,
  getAll: async () => (await Group.getAll()).map(mutableGroup),
};

interface ResolvedGroup {
  readonly name: string;
  readonly group: ExpoMutableContactGroup;
  readonly memberIds: ReadonlySet<string>;
}

interface AppliedMembershipChange {
  readonly kind: 'add' | 'remove';
  readonly group: ExpoMutableContactGroup;
}

/**
 * Mutates iOS group membership with optimistic concurrency and local
 * compensation. Missing or ambiguous names are rejected before any write.
 */
export class ExpoIosContactGroupMembershipWriter {
  constructor(private readonly api: ExpoContactGroupMutationApi = expoGroupMutationApi) {}

  async synchronize(
    sourceContactId: string,
    expectedGroups: readonly string[],
    desiredGroups: readonly string[],
  ): Promise<void> {
    if (this.api.platform !== 'ios') {
      throw new ContactWriteNotAppliedError('iOS group writer requires iOS.');
    }

    const expected = normalizedNames(expectedGroups);
    const desired = normalizedNames(desiredGroups);
    const changedNames = new Set([
      ...expected.filter((name) => !desired.includes(name)),
      ...desired.filter((name) => !expected.includes(name)),
    ]);
    if (changedNames.size === 0) return;

    const resolved = await this.resolveGroups(changedNames);
    const actualChangedMemberships = [...resolved.values()]
      .filter(({ memberIds }) => memberIds.has(sourceContactId))
      .map(({ name }) => name)
      .sort((left, right) => left.localeCompare(right));
    const expectedChangedMemberships = expected
      .filter((name) => changedNames.has(name))
      .sort((left, right) => left.localeCompare(right));
    if (!sameNames(actualChangedMemberships, expectedChangedMemberships)) {
      throw new ContactWriteNotAppliedError(
        `Contact ${sourceContactId} group membership changed after preflight.`,
      );
    }

    const changes: AppliedMembershipChange[] = [];
    try {
      for (const name of expected.filter((value) => !desired.includes(value))) {
        const group = resolved.get(name)?.group;
        if (!group) throw new Error(`Resolved group ${name} became unavailable.`);
        await group.removeContact(sourceContactId);
        changes.push({ kind: 'remove', group });
      }
      for (const name of desired.filter((value) => !expected.includes(value))) {
        const group = resolved.get(name)?.group;
        if (!group) throw new Error(`Resolved group ${name} became unavailable.`);
        await group.addContact(sourceContactId);
        changes.push({ kind: 'add', group });
      }
    } catch (cause) {
      try {
        await this.compensate(sourceContactId, changes);
      } catch {
        throw new Error(
          `iOS group membership outcome is unknown for contact ${sourceContactId}.`,
          { cause },
        );
      }
      throw new ContactWriteNotAppliedError(
        `iOS group membership was restored after a rejected write for contact ${sourceContactId}.`,
      );
    }
  }

  private async resolveGroups(
    names: ReadonlySet<string>,
  ): Promise<ReadonlyMap<string, ResolvedGroup>> {
    const matches = new Map<string, ResolvedGroup[]>();
    for (const group of await this.api.getAll()) {
      const name = (await group.getName())?.trim();
      if (!name || !names.has(name)) continue;
      const resolved: ResolvedGroup = {
        name,
        group,
        memberIds: new Set((await group.getContacts()).map(({ id }) => id)),
      };
      matches.set(name, [...(matches.get(name) ?? []), resolved]);
    }

    const result = new Map<string, ResolvedGroup>();
    for (const name of names) {
      const candidates = matches.get(name) ?? [];
      if (candidates.length !== 1) {
        throw new ContactWriteNotAppliedError(
          candidates.length === 0
            ? `iOS group ${name} does not exist.`
            : `iOS group ${name} is ambiguous across contact containers.`,
        );
      }
      result.set(name, candidates[0]);
    }
    return result;
  }

  private async compensate(
    sourceContactId: string,
    changes: readonly AppliedMembershipChange[],
  ): Promise<void> {
    for (const change of [...changes].reverse()) {
      if (change.kind === 'add') await change.group.removeContact(sourceContactId);
      else await change.group.addContact(sourceContactId);
    }
  }
}

function normalizedNames(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function sameNames(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
