import { ReadContactSource } from '@/application';
import { ExpoDeviceContactReader } from '@/infrastructure/contacts/expo';
import { ExpoCryptoIdGenerator } from '@/infrastructure/system/expo-crypto-id-generator';
import { SystemClock } from '@/infrastructure/system/system-clock';

export const readDeviceContacts = new ReadContactSource({
  contactReader: new ExpoDeviceContactReader(),
  clock: new SystemClock(),
  idGenerator: new ExpoCryptoIdGenerator(),
});
