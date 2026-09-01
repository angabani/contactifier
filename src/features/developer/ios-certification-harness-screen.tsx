import { useEffect, useMemo, useRef, useState } from 'react';
import Constants, { AppOwnership } from 'expo-constants';
import * as Device from 'expo-device';
import { getPermissionsAsync } from 'expo-contacts';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import type { CleanupWorkflow } from '@/domain';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { listContactBackups } from '@/composition/contact-backup';
import { iosCertificationFixtures } from '@/composition/ios-certification-fixtures';
import { manageCleanupWorkflow } from '@/composition/cleanup-workflow';
import { iosCertificationEvidence } from '@/composition/ios-certification-evidence';
import { iosCertificationPhotoEvidence } from '@/composition/ios-certification-photo-evidence';
import {
  certifySimulatorPermissionDenial,
  certifySimulatorPhotoRoundTrip,
  executeSimulatorVerificationFailureTrial,
  executeSimulatorLostWriteResponseTrial,
  executeSimulatorLostFinalizationResponseTrial,
} from '@/composition/simulator-contact-write';
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
import { createIosCertificationReport, type IosCertificationReport } from './ios-certification-report';
import { isSimulatorFixtureWritePlanOwned } from './simulator-fixture-write-policy';

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
  const [report, setReport] = useState<IosCertificationReport | null>(null);
  const [permissionMessage, setPermissionMessage] = useState('No permission-denial evidence recorded.');
  const [photoMessage, setPhotoMessage] = useState('No byte-level photo evidence recorded.');
  const [rollbackMessage, setRollbackMessage] = useState('No forced rollback trial recorded.');
  const [interruptionMessage, setInterruptionMessage] = useState('No lost-response trial recorded.');
  const [finalizationMessage, setFinalizationMessage] = useState('No finalization-recovery trial recorded.');

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
  const permissionTrialEnabled = __DEV__ && Platform.OS === 'ios' && !Device.isDevice &&
    Constants.appOwnership !== AppOwnership.Expo && !fullContactAccess &&
    confirmation === IOS_CERTIFICATION_CONFIRMATION && verifiedBackupIds.includes(backupId);
  const reportEnabled = __DEV__ && Platform.OS === 'ios' && !Device.isDevice &&
    Constants.appOwnership !== AppOwnership.Expo &&
    confirmation === IOS_CERTIFICATION_CONFIRMATION && verifiedBackupIds.includes(backupId);
  const reportItems = new Map(report?.items.map((item) => [item.id, item]));

  const refreshPermission = async () => {
    const permission = await getPermissionsAsync();
    setFullContactAccess(permission.granted && permission.accessPrivileges === 'all');
  };

  const runPermissionTrial = async () => {
    setFixtureBusy(true);
    try {
      await refreshPermission();
      const candidates: CleanupWorkflow[] = [];
      for (const summary of await manageCleanupWorkflow.listHistory()) {
        const workflow = await manageCleanupWorkflow.load(summary.id);
        if (
          workflow?.backupId === backupId && workflow.phase === 'preflighted' && workflow.writePlan &&
          isSimulatorFixtureWritePlanOwned(workflow.writePlan)
        ) candidates.push(workflow);
      }
      const workflow = candidates.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
      if (!workflow) throw new Error('Prepare an owned fixture transaction for this backup before revoking access.');
      const evidence = await certifySimulatorPermissionDenial(workflow);
      setPermissionMessage(`Verified ${evidence.workflowId}: revision ${evidence.revisionAfter} and ${evidence.journalEntriesAfter} journal entries remained unchanged.`);
    } catch (error) {
      setPermissionMessage(error instanceof Error ? error.message : 'Permission-denial trial failed.');
    } finally {
      setFixtureBusy(false);
    }
  };

  const runPhotoTrial = async () => {
    setFixtureBusy(true);
    try {
      const manifest = (await listContactBackups.execute()).find(({ id }) => id === backupId);
      if (!manifest) throw new Error('Select an available verified backup.');
      const candidates: CleanupWorkflow[] = [];
      for (const summary of await manageCleanupWorkflow.listHistory()) {
        const workflow = await manageCleanupWorkflow.load(summary.id);
        if (
          workflow?.backupId === backupId && workflow.phase === 'completed' && workflow.writePlan &&
          isSimulatorFixtureWritePlanOwned(workflow.writePlan)
        ) candidates.push(workflow);
      }
      const ordered = candidates.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      let lastError: unknown;
      for (const workflow of ordered) {
        try {
          const evidence = await certifySimulatorPhotoRoundTrip(workflow, manifest);
          setPhotoMessage(`Verified native contact ${evidence.nativeContactId}: ${evidence.actualSha256}.`);
          return;
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError ?? new Error('No completed owned photo restoration exists for this backup.');
    } catch (error) {
      setPhotoMessage(error instanceof Error ? error.message : 'Photo round-trip trial failed.');
    } finally {
      setFixtureBusy(false);
    }
  };

  const runRollbackTrial = async () => {
    setFixtureBusy(true);
    try {
      const candidates: CleanupWorkflow[] = [];
      for (const summary of await manageCleanupWorkflow.listHistory()) {
        const workflow = await manageCleanupWorkflow.load(summary.id);
        if (
          workflow?.backupId === backupId && workflow.phase === 'preflighted' &&
          workflow.writePlan?.operations.length === 1 &&
          isSimulatorFixtureWritePlanOwned(workflow.writePlan)
        ) candidates.push(workflow);
      }
      const workflow = candidates.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
      if (!workflow) throw new Error('Prepare one owned fixture change before running the rollback trial.');
      const result = await executeSimulatorVerificationFailureTrial(workflow);
      setRollbackMessage(`Workflow ${result.id} was compensated and verified as rolled back after forced verification failure.`);
    } catch (error) {
      setRollbackMessage(error instanceof Error ? error.message : 'Rollback trial failed.');
    } finally {
      setFixtureBusy(false);
    }
  };

  const runInterruptionTrial = async () => {
    setFixtureBusy(true);
    try {
      const candidates: CleanupWorkflow[] = [];
      for (const summary of await manageCleanupWorkflow.listHistory()) {
        const workflow = await manageCleanupWorkflow.load(summary.id);
        if (
          workflow?.backupId === backupId && workflow.phase === 'preflighted' &&
          workflow.writePlan?.operations.length === 1 &&
          isSimulatorFixtureWritePlanOwned(workflow.writePlan)
        ) candidates.push(workflow);
      }
      const workflow = candidates.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
      if (!workflow) throw new Error('Prepare one owned fixture change before running the interruption trial.');
      const result = await executeSimulatorLostWriteResponseTrial(workflow);
      setInterruptionMessage(`Workflow ${result.id} reconciled the applied native write without retry and completed compensation.`);
    } catch (error) {
      setInterruptionMessage(error instanceof Error ? error.message : 'Write-interruption trial failed.');
    } finally {
      setFixtureBusy(false);
    }
  };

  const runFinalizationTrial = async () => {
    setFixtureBusy(true);
    try {
      const candidates: CleanupWorkflow[] = [];
      for (const summary of await manageCleanupWorkflow.listHistory()) {
        const workflow = await manageCleanupWorkflow.load(summary.id);
        if (
          workflow?.backupId === backupId && workflow.phase === 'preflighted' &&
          workflow.writePlan?.operations.length === 1 &&
          workflow.writePlan.operations[0]?.kind === 'create' &&
          isSimulatorFixtureWritePlanOwned(workflow.writePlan)
        ) candidates.push(workflow);
      }
      const workflow = candidates.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
      if (!workflow) throw new Error('Prepare one owned fixture recreation before running finalization recovery.');
      const result = await executeSimulatorLostFinalizationResponseTrial(workflow);
      setFinalizationMessage(`Workflow ${result.id} resumed marker finalization with fresh authorization and completed.`);
    } catch (error) {
      setFinalizationMessage(error instanceof Error ? error.message : 'Finalization-recovery trial failed.');
    } finally {
      setFixtureBusy(false);
    }
  };

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

  const generateReport = async () => {
    setFixtureBusy(true);
    try {
      const fixtureSet = await iosCertificationFixtures.load();
      const workflows: CleanupWorkflow[] = [];
      for (const summary of await manageCleanupWorkflow.listHistory()) {
        const workflow = await manageCleanupWorkflow.load(summary.id);
        if (workflow) workflows.push(workflow);
      }
      setReport(createIosCertificationReport({
        generatedAt: new Date().toISOString(),
        selectedVerifiedBackupId: verifiedBackupIds.includes(backupId) ? backupId : undefined,
        fixtureSetReady: Boolean(fixtureSet?.fixtures.every(({ status }) => status === 'created')),
        workflows,
        permissionEvidence: await iosCertificationEvidence.load(),
        photoEvidence: await iosCertificationPhotoEvidence.load(),
      }));
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
            <ThemedText type="smallBold">Photo byte verification</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Reads the exact native contact from its durable create receipt and compares its photo SHA-256 with the authenticated backup asset. No contact is modified.
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{photoMessage}</ThemedText>
            <Pressable accessibilityRole="button" disabled={!armed || fixtureBusy} onPress={() => void runPhotoTrial()}
              style={[styles.actionButton, { backgroundColor: theme.primary }, (!armed || fixtureBusy) && styles.disabled]}>
              <ThemedText type="smallBold" style={styles.actionButtonText}>Verify restored photo bytes</ThemedText>
            </Pressable>
          </ThemedView>
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Forced verification-failure rollback</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Applies exactly one owned simulator fixture change, forces post-write verification to fail, and requires reverse compensation to finish before reporting success.
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{rollbackMessage}</ThemedText>
            <Pressable accessibilityRole="button" disabled={!armed || fixtureBusy} onPress={() => void runRollbackTrial()}
              style={[styles.actionButton, { backgroundColor: theme.primary }, (!armed || fixtureBusy) && styles.disabled]}>
              <ThemedText type="smallBold" style={styles.actionButtonText}>Run compensated rollback trial</ThemedText>
            </Pressable>
          </ThemedView>
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Lost native-write response</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Applies exactly one owned simulator fixture mutation, discards its response, then rereads native state to reconcile and compensate without retrying the mutation.
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{interruptionMessage}</ThemedText>
            <Pressable accessibilityRole="button" disabled={!armed || fixtureBusy} onPress={() => void runInterruptionTrial()}
              style={[styles.actionButton, { backgroundColor: theme.primary }, (!armed || fixtureBusy) && styles.disabled]}>
              <ThemedText type="smallBold" style={styles.actionButtonText}>Run lost-response recovery trial</ThemedText>
            </Pressable>
          </ThemedView>
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Lost marker-finalization response</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Recreates one owned fixture, removes its reconciliation marker, discards that response, then resumes idempotently under a fresh authorization.
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{finalizationMessage}</ThemedText>
            <Pressable accessibilityRole="button" disabled={!armed || fixtureBusy} onPress={() => void runFinalizationTrial()}
              style={[styles.actionButton, { backgroundColor: theme.primary }, (!armed || fixtureBusy) && styles.disabled]}>
              <ThemedText type="smallBold" style={styles.actionButtonText}>Run finalization recovery trial</ThemedText>
            </Pressable>
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
            {IOS_CERTIFICATION_SCENARIOS.map((scenario, index) => {
              const item = reportItems.get(scenario.id);
              return (
                <ThemedView key={scenario.id} type="backgroundElement" style={styles.card}>
                  <ThemedText type="smallBold">{index + 1}. {scenario.title}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {item?.evidence ?? scenario.expectedEvidence}
                  </ThemedText>
                  <ThemedText
                    type="smallBold"
                    themeColor={item?.status === 'passed' ? 'success' : item ? 'danger' : 'textSecondary'}>
                    {item?.status === 'passed'
                      ? '✓ Verified from durable evidence'
                      : item
                        ? `○ Pending ${target === 'simulator' ? 'simulator' : 'real-device'} evidence`
                        : 'Not evaluated yet'}
                  </ThemedText>
                </ThemedView>
              );
            })}
          </View>
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Permission-change evidence</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              First prepare an owned fixture transaction. Then revoke or limit Contacts access in Settings, return here, and refresh. This probe invokes the authorization gate only; it cannot invoke the native writer.
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{permissionMessage}</ThemedText>
            <Pressable accessibilityRole="button" disabled={fixtureBusy} onPress={() => void refreshPermission()}
              style={[styles.cleanupButton, fixtureBusy && styles.disabled]}>
              <ThemedText type="smallBold">Refresh contact permission</ThemedText>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={!permissionTrialEnabled || fixtureBusy} onPress={() => void runPermissionTrial()}
              style={[styles.actionButton, { backgroundColor: theme.primary }, (!permissionTrialEnabled || fixtureBusy) && styles.disabled]}>
              <ThemedText type="smallBold" style={styles.actionButtonText}>Record non-writing denial proof</ThemedText>
            </Pressable>
          </ThemedView>
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Evidence report</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Report generation is read-only and remains available while Contacts permission is revoked.
            </ThemedText>
            <Pressable accessibilityRole="button" disabled={!reportEnabled || fixtureBusy} onPress={() => void generateReport()}
              style={[styles.actionButton, { backgroundColor: theme.primary }, (!reportEnabled || fixtureBusy) && styles.disabled]}>
              <ThemedText type="smallBold" style={styles.actionButtonText}>Generate from durable evidence</ThemedText>
            </Pressable>
            {report && <>
              <ThemedText type="smallBold" themeColor={report.certified ? 'success' : 'danger'}>
                {report.certified ? 'CERTIFIED' : 'NOT CERTIFIED — evidence incomplete'}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Generated {new Date(report.generatedAt).toLocaleString()}
              </ThemedText>
              {report.items.map((item) => <ThemedText key={item.id} type="small" themeColor={item.status === 'passed' ? 'success' : 'textSecondary'}>
                {item.status === 'passed' ? '✓' : '○'} {item.id}: {item.evidence}
              </ThemedText>)}
            </>}
          </ThemedView>
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
