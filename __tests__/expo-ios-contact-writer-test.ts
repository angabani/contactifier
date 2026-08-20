import { ContactWriteNotAppliedError } from '@/application';
import { PermissionStatus } from 'expo';

jest.mock('expo-contacts', () => ({
  Contact: class MockContact {},
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
}));
import type { CanonicalContact, ContactWriteOperation } from '@/domain';
import {
  ExpoIosContactWriter,
  expoIosContactWriterCertification,
  mapCanonicalContactToExpoCreate,
  mapCanonicalContactToExpoPatch,
  type ExpoContactDetails,
  type ExpoContactWriterApi,
  type ExpoMutableContact,
} from '@/infrastructure/contacts/expo';

const source = { kind: 'device' as const };

function contact(nativeId: string, name = 'Ada Lovelace'): CanonicalContact {
  return {
    id: `device:default:${nativeId}`,
    recordRef: { source, sourceContactId: nativeId },
    displayName: name,
    name: { givenName: name, familyName: 'Byron' },
    nicknames: [{ id: 'nickname', value: 'Enchantress', label: 'nickname', origin: 'source' }],
    phoneNumbers: [{ id: 'phone', value: { raw: '+441234' }, label: 'mobile', origin: 'source' }],
    emailAddresses: [{ id: 'email', value: 'ada@example.com', label: 'work', origin: 'source' }],
    postalAddresses: [],
    organizations: [{ id: 'org', value: { name: 'Analytical Engines', title: 'Founder' }, origin: 'source' }],
    urls: [],
    birthdays: [],
    events: [],
    notes: [{ id: 'note', value: 'Private note', origin: 'source' }],
    groups: ['group-1'],
    photos: [{ uri: 'https://example.com/photo.jpg' }],
    extensions: {},
  };
}

function details(value: CanonicalContact): ExpoContactDetails {
  return {
    id: value.recordRef.sourceContactId,
    fullName: value.displayName,
    givenName: value.name?.givenName ?? null,
    middleName: value.name?.middleName ?? null,
    familyName: value.name?.familyName ?? null,
    nickname: value.nicknames[0]?.value ?? null,
    prefix: value.name?.prefix ?? null,
    suffix: value.name?.suffix ?? null,
    phoneticGivenName: value.name?.phoneticGivenName ?? null,
    phoneticMiddleName: value.name?.phoneticMiddleName ?? null,
    phoneticFamilyName: value.name?.phoneticFamilyName ?? null,
    company: value.organizations[0]?.value.name ?? null,
    department: value.organizations[0]?.value.department ?? null,
    jobTitle: value.organizations[0]?.value.title,
    image: null,
    thumbnail: null,
    birthday: null,
    emails: value.emailAddresses.map(({ label, value: address }, index) => ({ id: `e-${index}`, label, address })),
    phones: value.phoneNumbers.map(({ label, value: phone }, index) => ({ id: `p-${index}`, label, number: phone.raw })),
    addresses: [],
    extraNames: [],
    dates: [],
    urlAddresses: [],
  };
}

function apiFor(current: CanonicalContact, accessPrivileges: 'all' | 'limited' = 'all') {
  const patch = jest.fn<Promise<void>, [unknown]>().mockResolvedValue(undefined);
  const remove = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
  const native: ExpoMutableContact = {
    id: current.recordRef.sourceContactId,
    getDetails: () => Promise.resolve(details(current)),
    patch: patch as ExpoMutableContact['patch'],
    delete: remove,
  };
  const create = jest.fn().mockResolvedValue({ ...native, id: 'created-ios-id' });
  const api: ExpoContactWriterApi = {
    platform: 'ios',
    getPermissions: () =>
      Promise.resolve({
        granted: true,
        canAskAgain: true,
        expires: 'never',
        status: PermissionStatus.GRANTED,
        accessPrivileges,
      }),
    create,
    contact: () => native,
    getAllDetails: () => Promise.resolve([]),
  };
  return { api, create, patch, remove };
}

describe('Expo iOS contact writer boundary', () => {
  it('maps supported canonical fields without writing notes, groups, or remote photos', () => {
    const mapped = mapCanonicalContactToExpoCreate(contact('native-a'));

    expect(mapped).toMatchObject({
      givenName: 'Ada Lovelace',
      familyName: 'Byron',
      nickname: 'Enchantress',
      company: 'Analytical Engines',
      phones: [{ label: 'mobile', number: '+441234' }],
      emails: [{ label: 'work', address: 'ada@example.com' }],
    });
    expect(mapped).not.toHaveProperty('note');
    expect(mapped).not.toHaveProperty('groups');
    expect(mapped.image).toBeUndefined();
    expect(mapCanonicalContactToExpoPatch(contact('native-a'))).not.toHaveProperty('image');
    expect(mapCanonicalContactToExpoPatch(contact('native-a'))).not.toHaveProperty('birthday');
  });

  it('returns the iOS identifier after create', async () => {
    const current = contact('native-a');
    const { api, create } = apiFor(current);
    const operation: ContactWriteOperation = {
      id: 'create-1',
      changeId: 'change-1',
      kind: 'create',
      contact: current,
      reconciliationMarker: 'contactifier://write/snapshot/create-1',
    };

    await expect(new ExpoIosContactWriter(api).apply(operation)).resolves.toEqual({
      operationId: 'create-1',
      sourceContactId: 'created-ios-id',
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        urlAddresses: [
          {
            label: 'Contactifier operation',
            url: operation.reconciliationMarker,
          },
        ],
      }),
    );
  });

  it('reconciles an interrupted create only from one matching durable marker', async () => {
    const intended = { ...contact('planned-id'), notes: [], groups: [], photos: [] };
    const marker = 'contactifier://write/snapshot/create-interrupted';
    const operation: ContactWriteOperation = {
      id: 'create-interrupted',
      changeId: 'change-1',
      kind: 'create',
      contact: intended,
      reconciliationMarker: marker,
    };
    const createdDetails: ExpoContactDetails = {
      ...details(intended),
      id: 'created-ios-id',
      urlAddresses: [{ id: 'marker-url', label: 'Contactifier operation', url: marker }],
    };
    const base = apiFor(intended).api;
    const writer = new ExpoIosContactWriter({
      ...base,
      getAllDetails: () => Promise.resolve([createdDetails]),
    });

    await expect(writer.reconcile(operation)).resolves.toEqual({
      outcome: 'applied',
      receipt: { operationId: operation.id, sourceContactId: 'created-ios-id' },
    });
  });

  it('does not guess when an interrupted create marker is absent or duplicated', async () => {
    const intended = { ...contact('planned-id'), notes: [], groups: [], photos: [] };
    const marker = 'contactifier://write/snapshot/create-uncertain';
    const operation: ContactWriteOperation = {
      id: 'create-uncertain',
      changeId: 'change-1',
      kind: 'create',
      contact: intended,
      reconciliationMarker: marker,
    };
    const marked = {
      ...details(intended),
      id: 'created-ios-id',
      urlAddresses: [{ id: 'marker-url', label: 'Contactifier operation', url: marker }],
    } satisfies ExpoContactDetails;
    const base = apiFor(intended).api;

    await expect(
      new ExpoIosContactWriter({
        ...base,
        getAllDetails: () => Promise.resolve([]),
      }).reconcile(operation),
    ).resolves.toEqual({ outcome: 'not-applied' });
    await expect(
      new ExpoIosContactWriter({
        ...base,
        getAllDetails: () =>
          Promise.resolve([marked, { ...marked, id: 'another-created-ios-id' }]),
      }).reconcile(operation),
    ).resolves.toEqual({ outcome: 'ambiguous' });
  });

  it('removes a create marker idempotently and returns an auditable receipt', async () => {
    const intended = { ...contact('planned-id'), notes: [], groups: [], photos: [] };
    const marker = 'contactifier://write/snapshot/create-finalize';
    const operation = {
      id: 'create-finalize',
      changeId: 'change-1',
      kind: 'create' as const,
      contact: intended,
      reconciliationMarker: marker,
    };
    const nativeDetails: ExpoContactDetails = {
      ...details(intended),
      id: 'created-ios-id',
      urlAddresses: [{ id: 'marker-url', label: 'Contactifier operation', url: marker }],
    };
    const patch = jest.fn().mockResolvedValue(undefined);
    const base = apiFor(intended).api;
    const native: ExpoMutableContact = {
      id: 'created-ios-id',
      getDetails: () => Promise.resolve(nativeDetails),
      patch,
      delete: () => Promise.resolve(),
    };
    const writer = new ExpoIosContactWriter({ ...base, contact: () => native });

    await expect(
      writer.finalize(operation, {
        operationId: operation.id,
        sourceContactId: 'created-ios-id',
      }),
    ).resolves.toEqual({
      operationId: operation.id,
      sourceContactId: 'created-ios-id',
      removedReconciliationMarker: marker,
    });
    expect(patch).toHaveBeenCalledWith(expect.objectContaining({ urlAddresses: [] }));

    const alreadyFinalized = {
      ...native,
      getDetails: () => Promise.resolve({ ...nativeDetails, urlAddresses: [] }),
    };
    patch.mockClear();
    await new ExpoIosContactWriter({ ...base, contact: () => alreadyFinalized }).finalize(operation, {
      operationId: operation.id,
      sourceContactId: 'created-ios-id',
    });
    expect(patch).not.toHaveBeenCalled();
  });

  it('patches only after the native before-state still matches', async () => {
    const before = { ...contact('native-a'), notes: [], groups: [], photos: [] };
    const after = { ...before, displayName: 'Ada Updated', name: { ...before.name, givenName: 'Ada Updated' } };
    const { api, patch } = apiFor(before);
    const operation: ContactWriteOperation = {
      id: 'update-1',
      changeId: 'change-1',
      kind: 'update',
      sourceContactId: 'native-a',
      before,
      after,
    };

    await new ExpoIosContactWriter(api).apply(operation);
    expect(patch).toHaveBeenCalledWith(expect.objectContaining({ givenName: 'Ada Updated' }));
  });

  it('records the replacement iOS identifier when recreating a deleted contact', async () => {
    const before = contact('deleted-ios-id');
    const { api, create } = apiFor(before);

    await expect(
      new ExpoIosContactWriter(api).compensate(
        { kind: 'recreate-deleted', operationId: 'delete-1', contact: before },
        { operationId: 'delete-1', sourceContactId: 'deleted-ios-id' },
      ),
    ).resolves.toEqual({
      operationId: 'delete-1',
      kind: 'recreate-deleted',
      restoredSourceContactId: 'created-ios-id',
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('rejects limited access and stale targets before mutation', async () => {
    const before = contact('native-a');
    const operation: ContactWriteOperation = {
      id: 'delete-1',
      changeId: 'change-1',
      kind: 'delete',
      sourceContactId: 'native-a',
      before,
    };
    const limited = apiFor(before, 'limited');
    await expect(new ExpoIosContactWriter(limited.api).apply(operation)).rejects.toBeInstanceOf(
      ContactWriteNotAppliedError,
    );
    expect(limited.remove).not.toHaveBeenCalled();

    const stale = apiFor(contact('native-a', 'External change'));
    await expect(new ExpoIosContactWriter(stale.api).apply(operation)).rejects.toBeInstanceOf(
      ContactWriteNotAppliedError,
    );
    expect(stale.remove).not.toHaveBeenCalled();
  });

  it('remains explicitly uncertified and disabled', () => {
    expect(expoIosContactWriterCertification.enabled).toBe(false);
    expect(Object.values(expoIosContactWriterCertification.evidence)).not.toContain(true);
  });
});
