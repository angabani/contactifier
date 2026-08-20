import { randomUUID } from 'expo-crypto';

import { IosCertificationFixtureManager } from '@/features/developer/ios-certification-fixtures';
import {
  ExpoIosCertificationFixtureGateway,
  ExpoIosCertificationFixtureRepository,
} from '@/infrastructure/contacts/expo/expo-ios-certification-fixtures';

export const iosCertificationFixtures = new IosCertificationFixtureManager(
  new ExpoIosCertificationFixtureRepository(),
  new ExpoIosCertificationFixtureGateway(),
  randomUUID,
  () => new Date().toISOString(),
);
