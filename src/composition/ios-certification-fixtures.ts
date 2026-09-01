import { randomUUID } from 'expo-crypto';
import { Image } from 'react-native';

import { IosCertificationFixtureManager } from '@/features/developer/ios-certification-fixtures';
import {
  ExpoIosCertificationFixtureGateway,
  ExpoIosCertificationFixtureRepository,
} from '@/infrastructure/contacts/expo/expo-ios-certification-fixtures';

export const iosCertificationFixtures = new IosCertificationFixtureManager(
  new ExpoIosCertificationFixtureRepository(),
  new ExpoIosCertificationFixtureGateway(
    Image.resolveAssetSource(require('../../assets/images/icon.png')).uri,
  ),
  randomUUID,
  () => new Date().toISOString(),
);
