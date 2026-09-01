import { PrepareContactWrite, ReadContactSource } from '@/application';
import {
  ExpoDeviceContactReader,
  ExpoIosContactGroupMembershipReader,
} from '@/infrastructure/contacts/expo';
import { ExpoCryptoIdGenerator } from '@/infrastructure/system/expo-crypto-id-generator';
import { SystemClock } from '@/infrastructure/system/system-clock';

const systemClock = new SystemClock();
const idGenerator = new ExpoCryptoIdGenerator();

export const readDeviceContacts = new ReadContactSource({
  contactReader: new ExpoDeviceContactReader(
    undefined,
    new ExpoIosContactGroupMembershipReader(),
  ),
  clock: systemClock,
  idGenerator,
});

export const prepareDeviceContactWrite = new PrepareContactWrite(
  readDeviceContacts,
  systemClock,
);
