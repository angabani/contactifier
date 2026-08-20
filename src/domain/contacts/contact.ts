import type { JsonObject } from '../shared/json';
import type { ContactRecordRef } from './contact-source';
import type { ContactDate } from './contact-date';

export type { ContactDate } from './contact-date';

export type ContactId = string;
export type ContactValueId = string;

export type ContactFieldOrigin = 'merge' | 'ml' | 'rule' | 'source' | 'user';

export interface ContactValue<T> {
  readonly id: ContactValueId;
  readonly value: T;
  readonly label?: string;
  readonly isPrimary?: boolean;
  readonly origin: ContactFieldOrigin;
}

export interface StructuredName {
  readonly prefix?: string;
  readonly givenName?: string;
  readonly middleName?: string;
  readonly familyName?: string;
  readonly suffix?: string;
  readonly phoneticGivenName?: string;
  readonly phoneticMiddleName?: string;
  readonly phoneticFamilyName?: string;
}

export interface PhoneNumber {
  readonly raw: string;
  readonly normalized?: string;
  readonly countryCode?: string;
}

export interface PostalAddress {
  readonly formatted?: string;
  readonly street?: string;
  readonly city?: string;
  readonly region?: string;
  readonly postalCode?: string;
  readonly country?: string;
  readonly countryCode?: string;
}

export interface Organization {
  readonly name?: string;
  readonly department?: string;
  readonly title?: string;
  readonly role?: string;
}

export interface ContactEvent {
  readonly date: ContactDate;
  readonly label?: string;
}

export interface ContactPhotoRef {
  readonly uri: string;
  readonly hash?: string;
  readonly assetId?: string;
}

export interface CanonicalContact {
  readonly id: ContactId;
  readonly recordRef: ContactRecordRef;
  readonly displayName: string;
  readonly name?: StructuredName;
  readonly nicknames: readonly ContactValue<string>[];
  readonly phoneNumbers: readonly ContactValue<PhoneNumber>[];
  readonly emailAddresses: readonly ContactValue<string>[];
  readonly postalAddresses: readonly ContactValue<PostalAddress>[];
  readonly organizations: readonly ContactValue<Organization>[];
  readonly urls: readonly ContactValue<string>[];
  readonly birthdays: readonly ContactValue<ContactDate>[];
  readonly events: readonly ContactValue<ContactEvent>[];
  readonly notes: readonly ContactValue<string>[];
  readonly groups: readonly string[];
  readonly photos: readonly ContactPhotoRef[];
  readonly extensions: JsonObject;
}
