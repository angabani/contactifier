import type { ContactPatch, CreateContactRecord } from 'expo-contacts';

import type { CanonicalContact, ContactDate } from '@/domain';

function date(value: ContactDate): { day: number; month: number; year?: number } {
  return {
    day: value.day,
    month: value.month,
    ...(value.year === undefined ? {} : { year: value.year }),
  };
}

export function mapCanonicalContactToExpoCreate(
  contact: CanonicalContact,
  reconciliationMarker?: string,
): CreateContactRecord {
  const organization = contact.organizations[0]?.value;
  const hasStructuredName = Object.values(contact.name ?? {}).some(Boolean);
  return {
    givenName:
      contact.name?.givenName || (!hasStructuredName ? contact.displayName || undefined : undefined),
    middleName: contact.name?.middleName,
    familyName: contact.name?.familyName,
    prefix: contact.name?.prefix,
    suffix: contact.name?.suffix,
    phoneticGivenName: contact.name?.phoneticGivenName,
    phoneticMiddleName: contact.name?.phoneticMiddleName,
    phoneticFamilyName: contact.name?.phoneticFamilyName,
    nickname: contact.nicknames[0]?.value,
    company: organization?.name,
    department: organization?.department,
    jobTitle: organization?.title,
    phones: contact.phoneNumbers.map(({ label, value }) => ({ label, number: value.raw })),
    emails: contact.emailAddresses.map(({ label, value }) => ({ label, address: value })),
    addresses: contact.postalAddresses.map(({ label, value }) => ({
      label,
      street: value.street ?? value.formatted,
      city: value.city,
      region: value.region,
      state: value.region,
      postcode: value.postalCode,
      country: value.country,
    })),
    urlAddresses: [
      ...contact.urls.map(({ label, value }) => ({ label, url: value })),
      ...(reconciliationMarker
        ? [{ label: 'Contactifier operation', url: reconciliationMarker }]
        : []),
    ],
    birthday: contact.birthdays[0] ? date(contact.birthdays[0].value) : undefined,
    dates: contact.events.map(({ label, value }) => ({
      label: value.label ?? label,
      date: date(value.date),
    })),
    image: contact.photos[0]?.uri.startsWith('file:') ? contact.photos[0].uri : undefined,
  };
}

export function mapCanonicalContactToExpoPatch(contact: CanonicalContact): ContactPatch {
  const create = mapCanonicalContactToExpoCreate(contact);
  const {
    image: _preservedUntilPhotoBackupIsComplete,
    birthday: safeBirthday,
    ...supportedPatch
  } = create;
  return {
    ...supportedPatch,
    givenName: create.givenName ?? null,
    middleName: create.middleName ?? null,
    familyName: create.familyName ?? null,
    prefix: create.prefix ?? null,
    suffix: create.suffix ?? null,
    phoneticGivenName: create.phoneticGivenName ?? null,
    phoneticMiddleName: create.phoneticMiddleName ?? null,
    phoneticFamilyName: create.phoneticFamilyName ?? null,
    nickname: create.nickname ?? null,
    company: create.company ?? null,
    department: create.department ?? null,
    jobTitle: create.jobTitle ?? null,
    // Expo Contacts SDK 57 passes `null` to CNMutableContact.setBirthday on iOS, which raises an
    // Objective-C exception and terminates the process. Omission is the only safe partial-patch
    // behavior until clearing birthdays has a separately certified native implementation.
    ...(safeBirthday ? { birthday: safeBirthday } : {}),
  };
}
