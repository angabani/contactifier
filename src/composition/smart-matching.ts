import { ManageSmartMatching, type SmartModelArtifact, type SmartModelCatalog } from '@/application';
import { ExpoSmartMatchingPreferenceRepository } from '@/infrastructure/smart-matching/expo-smart-matching-preference-repository';
import { ExpoSmartModelArtifactStore } from '@/infrastructure/smart-matching/expo-smart-model-artifact-store';
import { createContactProbabilityModel, type ContactProbabilityModel } from '@/domain';
import {
  HttpSmartModelCatalog,
  StaticSmartModelCatalog,
  validateSmartModelArtifact,
} from '@/infrastructure/smart-matching/http-smart-model-catalog';
import { ExpoLocalSmartModelCatalog } from '@/infrastructure/smart-matching/expo-local-smart-model-catalog';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import Constants, { AppOwnership } from 'expo-constants';

function configuredArtifact(): SmartModelArtifact | undefined {
  const version = process.env.EXPO_PUBLIC_SMART_MODEL_VERSION;
  const url = process.env.EXPO_PUBLIC_SMART_MODEL_URL;
  const sha256 = process.env.EXPO_PUBLIC_SMART_MODEL_SHA256;
  const sizeValue = process.env.EXPO_PUBLIC_SMART_MODEL_SIZE_BYTES;
  if (!version || !url?.startsWith('https://') || !sha256?.match(/^[a-fA-F0-9]{64}$/)) return undefined;
  const sizeInBytes = sizeValue ? Number(sizeValue) : undefined;
  if (sizeInBytes !== undefined && (!Number.isSafeInteger(sizeInBytes) || sizeInBytes <= 0)) return undefined;
  return validateSmartModelArtifact({
    version,
    format: process.env.EXPO_PUBLIC_SMART_MODEL_FORMAT ?? 'contactifier-linear-v1',
    url,
    sha256,
    sizeInBytes,
  });
}

function configuredCatalog(): SmartModelCatalog {
  const manifestUrl = process.env.EXPO_PUBLIC_SMART_MODEL_MANIFEST_URL;
  if (manifestUrl?.startsWith('https://')) return new HttpSmartModelCatalog(manifestUrl);
  if (__DEV__ && Platform.OS === 'ios' && !Device.isDevice && Constants.appOwnership !== AppOwnership.Expo) {
    return new ExpoLocalSmartModelCatalog();
  }
  return new StaticSmartModelCatalog(configuredArtifact());
}

const artifactStore = new ExpoSmartModelArtifactStore();

export const smartMatching = new ManageSmartMatching(
  new ExpoSmartMatchingPreferenceRepository(),
  artifactStore,
  configuredCatalog(),
);

export async function loadSmartContactProbabilityModel(): Promise<ContactProbabilityModel | undefined> {
  const state = await smartMatching.load();
  if (state.status !== 'ready') return undefined;
  const [metadata, bytes] = await Promise.all([
    artifactStore.activeArtifact(),
    artifactStore.loadActiveBytes(),
  ]);
  if (!metadata || !bytes) return undefined;
  try {
    const model = createContactProbabilityModel(metadata.format, bytes);
    return model.version === state.activeVersion ? model : undefined;
  } catch {
    return undefined;
  }
}
