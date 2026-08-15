import { ContactField } from 'expo-contacts';

// NOTE is intentionally excluded: iOS requires a separately approved contacts-notes entitlement.
export const DEVICE_CONTACT_FIELDS = [
  ContactField.FULL_NAME,
  ContactField.GIVEN_NAME,
  ContactField.MIDDLE_NAME,
  ContactField.FAMILY_NAME,
  ContactField.NICKNAME,
  ContactField.PREFIX,
  ContactField.SUFFIX,
  ContactField.PHONETIC_GIVEN_NAME,
  ContactField.PHONETIC_MIDDLE_NAME,
  ContactField.PHONETIC_FAMILY_NAME,
  ContactField.COMPANY,
  ContactField.DEPARTMENT,
  ContactField.JOB_TITLE,
  ContactField.IMAGE,
  ContactField.THUMBNAIL,
  ContactField.BIRTHDAY,
  ContactField.EMAILS,
  ContactField.PHONES,
  ContactField.ADDRESSES,
  ContactField.EXTRA_NAMES,
  ContactField.DATES,
  ContactField.URL_ADDRESSES,
] as const;
