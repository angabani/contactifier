import type { PartialContactDetails } from 'expo-contacts';

import {
  createContactDate,
  type CanonicalContact,
  type ContactSourceRef,
  type ContactValue,
  type Organization,
  type StructuredName,
} from '@/domain';

import type { DEVICE_CONTACT_FIELDS } from './device-contact-fields';

export type ExpoContactDetails = PartialContactDetails<typeof DEVICE_CONTACT_FIELDS>;

function compact<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== ''),
  ) as T;
}

function valueId(contactId: string, field: string, nativeId: string | undefined, index: number): string {
  return nativeId ?? `${contactId}:${field}:${index}`;
}

export function normalizeExpoContactLabel(label: string | undefined): string | undefined {
  const trimmed = label?.trim();
  if (!trimmed) return undefined;
  const appleLocalizedLabel = trimmed.match(/^_\$!<(.+)>!\$_$/);
  return appleLocalizedLabel?.[1]?.trim() || trimmed;
}

function sourceValue<T>(id: string, value: T, label?: string): ContactValue<T> {
  return compact({ id, value, label: normalizeExpoContactLabel(label), origin: 'source' as const });
}

function mapContactDate(input: { readonly year?: number; readonly month: number; readonly day: number }) {
  const year = Number.isInteger(input.year) && input.year !== 0 ? input.year : undefined;
  try {
    return createContactDate({
      month: input.month,
      day: input.day,
      ...(year === undefined ? {} : { year }),
    });
  } catch {
    // Native stores can contain partial or malformed legacy dates. Preserve the
    // contact and omit only the invalid date rather than aborting the directory.
    return undefined;
  }
}

export function mapExpoContact(
  contact: ExpoContactDetails,
  source: ContactSourceRef,
): CanonicalContact {
  const canonicalId = `device:${source.containerId ?? 'default'}:${contact.id}`;
  const name: StructuredName = compact({
    prefix: contact.prefix ?? undefined,
    givenName: contact.givenName ?? undefined,
    middleName: contact.middleName ?? undefined,
    familyName: contact.familyName ?? undefined,
    suffix: contact.suffix ?? undefined,
    phoneticGivenName: contact.phoneticGivenName ?? undefined,
    phoneticMiddleName: contact.phoneticMiddleName ?? undefined,
    phoneticFamilyName: contact.phoneticFamilyName ?? undefined,
  });

  const nicknames = [
    ...(contact.nickname
      ? [sourceValue(`${contact.id}:nickname`, contact.nickname, 'nickname')]
      : []),
    ...(contact.extraNames ?? []).flatMap((item, index) =>
      item.name
        ? [sourceValue(valueId(contact.id, 'extraName', item.id, index), item.name, item.label)]
        : [],
    ),
  ];

  const organization: Organization = compact({
    name: contact.company ?? undefined,
    department: contact.department ?? undefined,
    title: contact.jobTitle,
  });

  return {
    id: canonicalId,
    recordRef: { source, sourceContactId: contact.id },
    displayName: contact.fullName?.trim() || contact.company?.trim() || '',
    ...(Object.keys(name).length > 0 ? { name } : {}),
    nicknames,
    phoneNumbers: (contact.phones ?? []).flatMap((item, index) =>
      item.number
        ? [
            sourceValue(
              valueId(contact.id, 'phone', item.id, index),
              { raw: item.number },
              item.label,
            ),
          ]
        : [],
    ),
    emailAddresses: (contact.emails ?? []).flatMap((item, index) =>
      item.address
        ? [sourceValue(valueId(contact.id, 'email', item.id, index), item.address, item.label)]
        : [],
    ),
    postalAddresses: (contact.addresses ?? []).map((item, index) =>
      sourceValue(
        valueId(contact.id, 'address', item.id, index),
        compact({
          street: item.street,
          city: item.city,
          region: item.region ?? item.state,
          postalCode: item.postcode,
          country: item.country,
        }),
        item.label,
      ),
    ),
    organizations:
      Object.keys(organization).length > 0
        ? [sourceValue(`${contact.id}:organization`, organization)]
        : [],
    urls: (contact.urlAddresses ?? []).flatMap((item, index) =>
      item.url
        ? [sourceValue(valueId(contact.id, 'url', item.id, index), item.url, item.label)]
        : [],
    ),
    birthdays: contact.birthday
      ? [mapContactDate(contact.birthday)].flatMap((date) => date
          ? [sourceValue(`${contact.id}:birthday`, date, 'birthday')]
          : [])
      : [],
    events: (contact.dates ?? []).flatMap((item, index) =>
      item.date
        ? [mapContactDate(item.date)].flatMap((date) => date ? [
            sourceValue(
              valueId(contact.id, 'event', item.id, index),
              { date, label: item.label },
              normalizeExpoContactLabel(item.label),
            ),
          ] : [])
        : [],
    ),
    notes: [],
    groups: [],
    photos: contact.image
      ? [{ uri: contact.image, assetId: `${canonicalId}:photo:0` }]
      : contact.thumbnail
        ? [{ uri: contact.thumbnail, assetId: `${canonicalId}:photo:0` }]
        : [],
    extensions: {},
  };
}
