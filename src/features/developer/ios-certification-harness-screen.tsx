import { useEffect, useMemo, useRef, useState } from 'react';
import Constants, { AppOwnership } from 'expo-constants';
import * as Device from 'expo-device';
import { getPermissionsAsync } from 'expo-contacts';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { listContactBackups } from '@/composition/contact-backup';
import { iosCertificationFixtures } from '@/composition/ios-certification-fixtures';
import { useTheme } from '@/hooks/use-theme';

import {
  canArmIosCertificationHarness,
  canAutoSeedIosSimulator,
  canManageIosCertificationFixtures,
  IOS_CERTIFICATION_CONFIRMATION,
  IOS_CERTIFICATION_SCENARIOS,
  iosCertificationTarget,
  iosCertificationDenialReasons,
} from './ios-certification-policy';

export function IosCertificationHarnessScreen() {
  const { seed } = useLocalSearchParams<{ seed?: string }>();
  const autoSeedStarted = useRef(false);
  const theme = useTheme();
  const [fullContactAccess, setFullContactAccess] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [backupId, setBackupId] = useState('');
  const [verifiedBackupIds, setVerifiedBackupIds] = useState<readonly string[]>([]);
  const [fixtureMessage, setFixtureMessage] = useState('No fixture status loaded.');
  const [fixtureBusy, setFixtureBusy] = useState(false);

  useEffect(() => {
    if (
      !__DEV__ ||
      Platform.OS !== 'ios' ||
      Constants.appOwnership === AppOwnership.Expo
    ) return;
    void getPermissionsAsync().then((permission) => {
      setFullContactAccess(permission.granted && permission.accessPrivileges === 'all');
    }).catch(() => setFullContactAccess(false));
    void listContactBackups.execute().then((backups) => {
      setVerifiedBackupIds(backups.map(({ id }) => id));
    }).catch(() => setVerifiedBackupIds([]));
    void iosCertificationFixtures.load().then((set) => {
      setFixtureMessage(set
        ? `Fixture set ${set.id}: ${set.fixtures.map(({ key, status }) => `${key} ${status}`).join(', ')}`
        : 'No disposable fixture set exists.');
    }).catch(() => setFixtureMessage('Fixture metadata could not be read.'));
  }, []);

  const environment = useMemo(() => ({
    development: __DEV__,
    platform: Platform.OS,
    physicalDevice: Device.isDevice,
    expoGo: Constants.appOwnership === AppOwnership.Expo,
    fullContactAccess,
  }), [fullContactAccess]);
  const denialReasons = iosCertificationDenialReasons(environment);
  const target = iosCertificationTarget(environment);
  const armed = canArmIosCertificationHarness({
    environment,
    confirmation,
    selectedBackupId: backupId,
    verifiedBackupIds,
  });
  const fixturesEnabled = canManageIosCertificationFixtures({ environment, confirmation });

  useEffect(() => {
    if (autoSeedStarted.current || !canAutoSeedIosSimulator({ environment, seedToken: seed })) return;
    autoSeedStarted.current = true;
    setFixtureBusy(true);
    setFixtureMessage('Creating versioned simulator certification dataset…');
    void iosCertificationFixtures.setup().then((result) => {
      setFixtureMessage(result.outcome === 'ready'
        ? `Simulator dataset ready: ${result.fixtureSet.fixtures.length} owned contacts across version ${result.fixtureSet.datasetVersion}.`
        : `Simulator dataset stopped safely: ${result.outcome}.`);
    }).catch((error: unknown) => {
      setFixtureMessage(error instanceof Error ? error.message : 'Simulator dataset setup failed.');
    }).finally(() => setFixtureBusy(false));
  }, [environment, seed]);

  const setupFixtures = async () => {
    setFixtureBusy(true);
    try {
      const result = await iosCertificationFixtures.setup();
      setFixtureMessage(
        result.outcome === 'ready'
          ? `Fixture set ${result.fixtureSet.id} is ready. Scan contacts now and create a verified backup before testing.`
          : `Fixture setup stopped safely: ${result.outcome}. Press setup again only for retry-required; ambiguous fixtures require inspection.`,
      );
    } catch (error) {
      setFixtureMessage(error instanceof Error ? error.message : 'Fixture setup failed.');
    } finally {
      setFixtureBusy(false);
    }
  };

  const cleanupFixtures = async () => {
    setFixtureBusy(true);
    try {
      const result = await iosCertificationFixtures.cleanup();
      setFixtureMessage(`Cleanup deleted ${result.deleted}; retained ${result.retained} because ownership was not provable.`);
    } catch (error) {
      setFixtureMessage(error instanceof Error ? error.message : 'Fixture cleanup failed.');
    } finally {
      setFixtureBusy(false);
    }
  };

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText style={styles.eyebrow}>DEVELOPER ONLY</ThemedText>
          <ThemedText type="title">iOS writer certification</ThemedText>
          <ThemedView type="backgroundElement" style={styles.environmentBadge}>
            <ThemedText type="smallBold" themeColor={target === 'simulator' ? 'success' : 'danger'}>
              {target === 'simulator' ? 'SIMULATOR — disposable virtual contacts' : 'PHYSICAL DEVICE — real contact store'}
            </ThemedText>
          </ThemedView>
          <ThemedText themeColor="textSecondary">
            This harness never certifies itself and does not register the iOS writer in production.
            Use only contacts created specifically for destructive testing.
          </ThemedText>

          {denialReasons.length > 0 && (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">Harness locked</ThemedText>
              {denialReasons.map((reason) => (
                <ThemedText key={reason} type="small" themeColor="danger">• {reason}</ThemedText>
              ))}
            </ThemedView>
          )}

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Arming prerequisites</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Enter the exact verified backup ID for this disposable fixture set.
            </ThemedText>
            <TextInput
              accessibilityLabel="Verified backup ID"
              autoCapitalize="none"
              onChangeText={setBackupId}
              placeholder="Verified backup ID"
              style={styles.input}
              value={backupId}
            />
            <ThemedText type="small" themeColor="textSecondary">
              {verifiedBackupIds.length} verified backup IDs are currently available.
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Type: {IOS_CERTIFICATION_CONFIRMATION}
            </ThemedText>
            <TextInput
              accessibilityLabel="Certification confirmation"
              autoCapitalize="characters"
              onChangeText={setConfirmation}
              placeholder="Confirmation phrase"
              style={styles.input}
              value={confirmation}
            />
            <ThemedText type="smallBold" themeColor={armed ? 'success' : 'danger'}>
              {armed ? 'Prerequisites satisfied — scenarios remain manually gated.' : 'Not armed'}
            </ThemedText>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Disposable merge fixtures</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Ownership is recorded before creation. Cleanup rereads each native contact and requires both its unique URL marker and exact visible test name.
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{fixtureMessage}</ThemedText>
            {fixtureBusy && <ActivityIndicator />}
            <Pressable
              accessibilityRole="button"
              disabled={!fixturesEnabled || fixtureBusy}
              onPress={() => void setupFixtures()}
              style={[styles.actionButton, { backgroundColor: theme.primary }, (!fixturesEnabled || fixtureBusy) && styles.disabled]}>
              <ThemedText type="smallBold" style={styles.actionButtonText}>Create / resume fixtures</ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!fixturesEnabled || fixtureBusy}
              onPress={() => void cleanupFixtures()}
              style={[styles.cleanupButton, (!fixturesEnabled || fixtureBusy) && styles.disabled]}>
              <ThemedText type="smallBold" themeColor="danger">Clean up owned fixtures</ThemedText>
            </Pressable>
          </ThemedView>

          <View style={styles.scenarios}>
            {IOS_CERTIFICATION_SCENARIOS.map((scenario, index) => (
              <ThemedView key={scenario.id} type="backgroundElement" style={styles.card}>
                <ThemedText type="smallBold">{index + 1}. {scenario.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {scenario.expectedEvidence}
                </ThemedText>
                <ThemedText type="small" themeColor="danger">
                  Pending {target === 'simulator' ? 'simulator' : 'real-device'} evidence
                </ThemedText>
              </ThemedView>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safeArea: { flex: 1 },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  eyebrow: { fontSize: 12, lineHeight: 16, fontWeight: '800', letterSpacing: 1.8 },
  environmentBadge: { alignSelf: 'flex-start', paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: 8 },
  card: { gap: Spacing.two, padding: Spacing.three, borderRadius: Spacing.three },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: '#8A8A8A',
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    color: '#111111',
    backgroundColor: '#FFFFFF',
  },
  scenarios: { gap: Spacing.two },
  actionButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  actionButtonText: { color: '#FFFFFF' },
  cleanupButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: '#B42318' },
  disabled: { opacity: 0.45 },
});
