import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Constants, { AppOwnership } from 'expo-constants';
import * as Device from 'expo-device';
import { useEffect, useMemo, useRef, useState } from 'react';

import { createBeautificationChangeSet } from '@/application';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { SuccessCelebration, TaskProgress } from '@/components/task-progress';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { resolveHomePriority } from '@/features/home/resolve-home-priority';
import { useSmartMatching } from '@/features/smart-matching/use-smart-matching';
import {
  IOS_SIMULATOR_LOCAL_MODEL_TOKEN,
  IOS_SIMULATOR_DISCARD_REVIEW_TOKEN,
  IOS_SIMULATOR_READ_ONLY_SCAN_TOKEN,
  IOS_SIMULATOR_RESUME_REVIEW_TOKEN,
} from '@/features/developer/ios-certification-policy';

import { useDeviceContactScanSession } from './use-device-contact-scan';

export function DeviceContactScanScreen() {
  const { discard: discardToken, resume: resumeToken, scan: scanToken, smartModel: smartModelToken } = useLocalSearchParams<{
    discard?: string;
    resume?: string;
    scan?: string;
    smartModel?: string;
  }>();
  const theme = useTheme();
  const router = useRouter();
  const smartMatching = useSmartMatching();
  const [showScanDetails, setShowScanDetails] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const {
    state,
    scan,
    resumableWorkflow,
    isResuming,
    resumeError,
    resume,
    isDiscardingWorkflow,
    discardWorkflowError,
    discardResumableWorkflow,
    rescoreWithSmartModel,
  } = useDeviceContactScanSession();
  const previousStatus = useRef(state.status);
  const previousSmartStatus = useRef(smartMatching.state?.status);
  const automaticReadOnlyScanStarted = useRef(false);
  const automaticLocalModelStarted = useRef(false);
  const automaticDiscardStarted = useRef(false);
  const automaticResumeStarted = useRef(false);
  const celebrateNextSuccess = useRef(false);
  const isBusy =
    state.status === 'scanning' ||
    state.status === 'backing-up' ||
    isResuming ||
    isDiscardingWorkflow;
  const isWeb = Platform.OS === 'web';
  const showIosCertification =
    __DEV__ && Platform.OS === 'ios' && Constants.appOwnership !== AppOwnership.Expo;
  const suggestionCount = useMemo(() => state.status === 'success'
    ? createBeautificationChangeSet({
        snapshot: state.snapshot,
        duplicateAnalysis: state.analysis,
        matchAnalysis: state.matchAnalysis,
        qualityAnalysis: state.quality,
        createdAt: state.snapshot.createdAt,
      }).changes.length
    : 0, [state]);
  const homePriority = resolveHomePriority({
    hasRestoreConflict: false,
    hasInterruptedChange: Boolean(
      resumableWorkflow && !['reviewing', 'preflighted'].includes(resumableWorkflow.phase),
    ),
    hasPreparedApproval: resumableWorkflow?.phase === 'preflighted',
    hasSavedReview: resumableWorkflow?.phase === 'reviewing',
    suggestionCount,
    hasVerifiedBaseline: state.status === 'success',
  });

  useEffect(() => {
    if (
      celebrateNextSuccess.current && state.status === 'success' && previousStatus.current !== 'success'
      && scanToken !== IOS_SIMULATOR_READ_ONLY_SCAN_TOKEN
    ) {
      celebrateNextSuccess.current = false;
      setShowCelebration(true);
    }
    previousStatus.current = state.status;
  }, [scanToken, state.status]);

  useEffect(() => {
    if (smartMatching.state?.status === 'ready' && previousSmartStatus.current !== 'ready') {
      void rescoreWithSmartModel();
    }
    previousSmartStatus.current = smartMatching.state?.status;
  }, [rescoreWithSmartModel, smartMatching.state?.status]);

  useEffect(() => {
    if (
      automaticReadOnlyScanStarted.current || !__DEV__ || Platform.OS !== 'ios' || Device.isDevice
      || Constants.appOwnership === AppOwnership.Expo || scanToken !== IOS_SIMULATOR_READ_ONLY_SCAN_TOKEN
    ) return;
    automaticReadOnlyScanStarted.current = true;
    void scan();
  }, [scan, scanToken]);

  useEffect(() => {
    if (
      automaticLocalModelStarted.current || !__DEV__ || Platform.OS !== 'ios' || Device.isDevice
      || Constants.appOwnership === AppOwnership.Expo || smartModelToken !== IOS_SIMULATOR_LOCAL_MODEL_TOKEN
      || smartMatching.state?.status !== 'available'
    ) return;
    automaticLocalModelStarted.current = true;
    void smartMatching.enable();
  }, [smartMatching, smartModelToken]);

  useEffect(() => {
    if (
      automaticDiscardStarted.current || !resumableWorkflow || !__DEV__ || Platform.OS !== 'ios'
      || Device.isDevice || Constants.appOwnership === AppOwnership.Expo
      || discardToken !== IOS_SIMULATOR_DISCARD_REVIEW_TOKEN
    ) return;
    automaticDiscardStarted.current = true;
    void discardResumableWorkflow();
  }, [discardResumableWorkflow, discardToken, resumableWorkflow]);

  useEffect(() => {
    if (
      automaticResumeStarted.current || !resumableWorkflow || !__DEV__ || Platform.OS !== 'ios'
      || Device.isDevice || Constants.appOwnership === AppOwnership.Expo
      || resumeToken !== IOS_SIMULATOR_RESUME_REVIEW_TOKEN
    ) return;
    automaticResumeStarted.current = true;
    void resume().then((resumed) => {
      if (resumed) router.push('/review');
    });
  }, [resume, resumeToken, resumableWorkflow, router]);

  const modelSize = smartMatching.state?.downloadSizeInBytes;
  const modelSizeLabel = modelSize
    ? `${modelSize >= 1024 * 1024 ? (modelSize / (1024 * 1024)).toFixed(1) : Math.ceil(modelSize / 1024)} ${modelSize >= 1024 * 1024 ? 'MB' : 'KB'}`
    : null;

  const startScan = () => {
    if (
      Platform.OS !== 'web' &&
      smartMatching.state?.consent === 'undecided' &&
      smartMatching.state.status === 'available'
    ) {
      Alert.alert(
        'Find more likely duplicates',
        `Catches typos, similar names, and matches that need several clues.${modelSizeLabel ? ` Download: ${modelSizeLabel}.` : ''} Runs only on this device. Your contacts are never uploaded.`,
        [
          {
            text: 'Use basic matching',
            onPress: () => {
              celebrateNextSuccess.current = true;
              void smartMatching.disable();
              void scan();
            },
          },
          {
            text: 'Download smart matching',
            onPress: () => {
              celebrateNextSuccess.current = true;
              void smartMatching.enable();
              void scan();
            },
          },
        ],
      );
      return;
    }
    celebrateNextSuccess.current = true;
    void scan();
  };

  return (
    <ThemedView style={styles.screen}>
      {state.status === 'success' && (
        <SuccessCelebration
          visible={showCelebration}
          count={suggestionCount}
          scannedCount={state.snapshot.contacts.length}
          onClose={() => setShowCelebration(false)}
          onContinue={() => { setShowCelebration(false); router.push('/review'); }}
        />
      )}
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          <View style={styles.content}>
            <View style={styles.topBar}>
              <View style={[styles.brandMark, { backgroundColor: theme.primarySoft }]}> 
                <ThemedText style={[styles.brandLetter, { color: theme.primary }]}>C</ThemedText>
              </View>
            </View>

            <View style={styles.heading}>
              <View style={[styles.eyebrowPill, { backgroundColor: theme.primarySoft }]}>
                <ThemedText style={[styles.eyebrow, { color: theme.primary }]}>YOUR CONTACT CARE ASSISTANT</ThemedText>
              </View>
              <ThemedText type="title" style={styles.title}>
                {homePriority === 'continue-saved-review'
                  ? 'Continue where you left off.'
                  : homePriority === 'everything-looks-good'
                  ? 'Everything looks good.'
                  : homePriority === 'review-suggestions'
                    ? 'Your review is ready.'
                    : resumableWorkflow
                      ? 'Continue where you left off.'
                      : 'First, scan your contacts.'}
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.subtitle}>
                {homePriority === 'continue-saved-review'
                  ? 'Your protected review is ready to resume.'
                  : homePriority === 'everything-looks-good'
                  ? 'There is nothing you need to approve right now.'
                  : homePriority === 'review-suggestions'
                    ? 'Check the suggestions and approve only what you want.'
                    : resumableWorkflow
                      ? 'Your protected cleanup is ready to resume.'
                      : 'We’ll find duplicates and incomplete details. This first scan is read-only.'}
              </ThemedText>
            </View>

            <ThemedView type="backgroundElement" style={styles.privacyCard}>
              <View style={[styles.privacyDot, { backgroundColor: theme.success }]} />
              <View style={styles.privacyCopy}>
                <ThemedText type="smallBold">Private by design</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  This scan is read-only. Your contact data stays on this device and nothing is
                  changed automatically.
                </ThemedText>
              </View>
            </ThemedView>

            {resumableWorkflow && state.status !== 'scanning' && state.status !== 'backing-up' && (
              <ThemedView type="backgroundElement" style={styles.resumeCard}>
                <View style={styles.resultCopy}>
                  <ThemedText type="smallBold">Continue your saved cleanup</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Your encrypted review is saved at the {resumableWorkflow.phase.replace('-', ' ')} step.
                  </ThemedText>
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={isBusy}
                  onPress={() => {
                    void resume().then((resumed) => {
                      if (resumed) router.push('/review');
                    });
                  }}
                  style={[styles.resumeButton, { backgroundColor: theme.primary }, isBusy && styles.buttonMuted]}>
                  {isResuming ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <ThemedText style={styles.buttonText}>Resume cleanup</ThemedText>
                  )}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={isBusy}
                  onPress={() =>
                    Alert.alert(
                      'Discard saved cleanup?',
                      'This removes your saved review progress. Your verified contact backup will be kept.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Discard',
                          style: 'destructive',
                          onPress: () => void discardResumableWorkflow(),
                        },
                      ],
                    )
                  }
                  style={styles.discardButton}>
                  <ThemedText type="smallBold" themeColor="danger">
                    {isDiscardingWorkflow ? 'Discarding…' : 'Discard saved cleanup'}
                  </ThemedText>
                </Pressable>
              </ThemedView>
            )}

            {resumeError && (
              <View style={[styles.messageCard, { borderColor: theme.danger }]}>
                <ThemedText type="smallBold">Saved cleanup could not be resumed</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Its matching encrypted backup or device key is unavailable. Your contacts were not changed.
                </ThemedText>
              </View>
            )}

            {discardWorkflowError && (
              <View style={[styles.messageCard, { borderColor: theme.danger }]}>
                <ThemedText type="smallBold">Saved cleanup could not be discarded</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  No contact or backup was changed. Please try again.
                </ThemedText>
              </View>
            )}

            {state.status === 'backing-up' && (
              <TaskProgress
                title={state.phase === 'encrypting' ? 'Creating your safety backup' : 'Double-checking your backup'}
                detail={`${state.completedContacts} of ${state.totalContacts} contacts protected`}
                progress={state.totalContacts > 0 ? state.completedContacts / state.totalContacts : 0}
              />
            )}

            {state.status === 'scanning' && (
              <TaskProgress title="Looking for easy wins" detail="Finding duplicates and incomplete details on your device…" />
            )}

            {state.status === 'success' && !resumableWorkflow && (
              <View style={styles.resultsSection}>
                <ThemedView type="backgroundElement" style={styles.scanSummaryCard}>
                  <View style={[styles.scanSummaryMark, { backgroundColor: theme.primarySoft }]}>
                    <ThemedText style={[styles.scanSummaryMarkText, { color: theme.primary }]}>✓</ThemedText>
                  </View>
                  <ThemedText type="subtitle">
                    {suggestionCount > 0
                      ? `${suggestionCount} ${suggestionCount === 1 ? 'suggestion' : 'suggestions'} ready to review`
                      : 'Your contacts look clean'}
                  </ThemedText>
                  <ThemedText themeColor="textSecondary" style={styles.scanSummaryCopy}>
                    {state.mode === 'demo'
                      ? `${state.snapshot.contacts.length} demo contacts scanned. Your real contacts were not used.`
                      : `${state.snapshot.contacts.length} contacts scanned and safely backed up. Nothing has been changed.`}
                  </ThemedText>
                  {suggestionCount > 0 && (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => router.push('/review')}
                      style={[styles.reviewButton, { backgroundColor: theme.primary }]}>
                      <ThemedText style={styles.buttonText}>Review suggestions</ThemedText>
                    </Pressable>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: showScanDetails }}
                    onPress={() => setShowScanDetails((visible) => !visible)}
                    style={styles.detailsButton}>
                    <ThemedText type="smallBold" style={{ color: theme.primary }}>
                      {showScanDetails ? 'Hide scan details' : 'View scan details'}
                    </ThemedText>
                  </Pressable>
                </ThemedView>

                {showScanDetails && <>
                <ThemedView type="backgroundElement" style={styles.analysisCard}>
                  <View style={styles.analysisHeader}>
                    <View>
                      <ThemedText type="smallBold">Potential duplicate pairs</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        Exact phone and email matches
                      </ThemedText>
                    </View>
                    <ThemedText style={[styles.analysisCount, { color: theme.primary }]}>
                      {state.analysis.matches.length}
                    </ThemedText>
                  </View>

                  <View style={styles.analysisBreakdown}>
                    <View style={styles.analysisMetric}>
                      <ThemedText type="small" themeColor="textSecondary">
                        Phone
                      </ThemedText>
                      <ThemedText type="smallBold">{state.analysis.phoneMatchCount}</ThemedText>
                    </View>
                    <View style={styles.analysisMetric}>
                      <ThemedText type="small" themeColor="textSecondary">
                        Email
                      </ThemedText>
                      <ThemedText type="smallBold">{state.analysis.emailMatchCount}</ThemedText>
                    </View>
                    <View style={styles.analysisMetric}>
                      <ThemedText type="small" themeColor="textSecondary">
                        Contacts
                      </ThemedText>
                      <ThemedText type="smallBold">
                        {state.analysis.affectedContactIds.length}
                      </ThemedText>
                    </View>
                  </View>

                  {state.analysis.matches.length === 0 && (
                    <ThemedText type="small" themeColor="textSecondary">
                      No exact duplicates found. Use the demo data below to test the review flow.
                    </ThemedText>
                  )}

                  {state.analysis.isTruncated && (
                    <View style={[styles.messageCard, { borderColor: theme.danger }]}>
                      <ThemedText type="smallBold">Duplicate results limited for safety</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        Review this batch, then scan again. Contactifier will not create an
                        unbounded number of pair suggestions from one shared value.
                      </ThemedText>
                    </View>
                  )}

                </ThemedView>

                <ThemedView type="backgroundElement" style={styles.analysisCard}>
                  <View style={styles.analysisHeader}>
                    <View>
                      <ThemedText type="smallBold">Contact quality</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        Safe cleanup and incomplete-contact checks
                      </ThemedText>
                    </View>
                    <ThemedText style={[styles.analysisCount, { color: theme.primary }]}>
                      {state.quality.findings.length}
                    </ThemedText>
                  </View>
                  <View style={styles.analysisBreakdown}>
                    <View style={styles.analysisMetric}>
                      <ThemedText type="small" themeColor="textSecondary">Updates</ThemedText>
                      <ThemedText type="smallBold">{state.quality.updateCount}</ThemedText>
                    </View>
                    <View style={styles.analysisMetric}>
                      <ThemedText type="small" themeColor="textSecondary">Empty</ThemedText>
                      <ThemedText type="smallBold">{state.quality.deleteCandidateCount}</ThemedText>
                    </View>
                    <View style={styles.analysisMetric}>
                      <ThemedText type="small" themeColor="textSecondary">Missing name</ThemedText>
                      <ThemedText type="smallBold">{state.quality.missingNameCount}</ThemedText>
                    </View>
                  </View>
                  {state.quality.findings.length === 0 && (
                    <ThemedText type="small" themeColor="textSecondary">
                      No safe quality improvements were found.
                    </ThemedText>
                  )}
                </ThemedView>

                <ThemedView type="backgroundElement" style={styles.analysisCard}>
                  <View style={styles.analysisHeader}>
                    <View style={styles.resultCopy}>
                      <ThemedText type="smallBold">Changes since previous backup</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {state.delta.hasBaseline
                          ? 'Every current contact, including new and updated records, was included in this scan.'
                          : 'First tracked scan. All current contacts establish the baseline.'}
                      </ThemedText>
                    </View>
                    <ThemedText style={[styles.analysisCount, { color: theme.primary }]}>
                      {state.delta.beautificationContactIds.length}
                    </ThemedText>
                  </View>

                  <View style={styles.deltaGrid}>
                    <View style={styles.deltaMetric}>
                      <ThemedText type="small" themeColor="textSecondary">New</ThemedText>
                      <ThemedText type="smallBold">{state.delta.addedContactIds.length}</ThemedText>
                    </View>
                    <View style={styles.deltaMetric}>
                      <ThemedText type="small" themeColor="textSecondary">Updated</ThemedText>
                      <ThemedText type="smallBold">{state.delta.updatedContactIds.length}</ThemedText>
                    </View>
                    <View style={styles.deltaMetric}>
                      <ThemedText type="small" themeColor="textSecondary">Deleted</ThemedText>
                      <ThemedText type="smallBold">{state.delta.deletedContactIds.length}</ThemedText>
                    </View>
                    <View style={styles.deltaMetric}>
                      <ThemedText type="small" themeColor="textSecondary">Unchanged</ThemedText>
                      <ThemedText type="smallBold">{state.delta.unchangedContactIds.length}</ThemedText>
                    </View>
                  </View>

                  {state.delta.unavailableContactIds.length > 0 && (
                    <ThemedText type="small" themeColor="textSecondary">
                      {state.delta.unavailableContactIds.length} previous contacts are unavailable
                      under limited access and are not treated as deleted.
                    </ThemedText>
                  )}
                </ThemedView>
                </>}
              </View>
            )}

            {state.status === 'permission-denied' && (
              <View style={[styles.messageCard, { borderColor: theme.danger }]}>
                <ThemedText type="smallBold">Contact access is required</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Contactifier cannot scan until you allow access to your contacts.
                </ThemedText>
                {!state.canAskAgain && (
                  <Pressable onPress={() => void Linking.openSettings()} hitSlop={8}>
                    <ThemedText style={{ color: theme.primary }} type="smallBold">
                      Open Settings
                    </ThemedText>
                  </Pressable>
                )}
              </View>
            )}

            {state.status === 'error' && (
              <View style={[styles.messageCard, { borderColor: theme.danger }]}>
                <ThemedText type="smallBold">The scan could not be completed</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Your contacts were not changed. Please try again.
                </ThemedText>
              </View>
            )}

            {state.status === 'backup-error' && (
              <View style={[styles.messageCard, { borderColor: theme.danger }]}>
                <ThemedText type="smallBold">A verified backup could not be created</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Analysis was stopped and your contacts were not changed. Check available storage
                  and try again.
                </ThemedText>
              </View>
            )}

            {state.status !== 'success' && !resumableWorkflow && <View style={styles.actionArea}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Scan device contacts"
                disabled={isBusy || isWeb}
                onPress={startScan}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: theme.primary },
                  (pressed || isBusy || isWeb) && styles.buttonMuted,
                ]}>
                {isBusy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <ThemedText style={styles.buttonText}>
                    Scan device contacts
                  </ThemedText>
                )}
              </Pressable>

              <ThemedText type="small" themeColor="textSecondary" style={styles.actionHint}>
                {isWeb
                  ? 'Device contact scanning is available on iOS and Android.'
                  : 'You choose which suggested changes to apply.'}
              </ThemedText>
            </View>}
            {showIosCertification && (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/ios-certification' as never)}
                style={styles.developerButton}>
                <ThemedText type="smallBold" themeColor="danger">
                  Open developer iOS certification harness
                </ThemedText>
              </Pressable>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safeArea: { flex: 1 },
  scrollContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
    gap: Spacing.four,
  },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  brandMark: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandLetter: { fontSize: 30, lineHeight: 36, fontWeight: '800' },
  heading: { gap: Spacing.two },
  eyebrowPill: { alignSelf: 'flex-start', paddingHorizontal: 11, paddingVertical: 6, borderRadius: 99 },
  eyebrow: { fontSize: 11, lineHeight: 14, fontWeight: '800', letterSpacing: 1.1 },
  title: { fontSize: 40, lineHeight: 44, maxWidth: 560 },
  subtitle: { fontSize: 18, lineHeight: 27, maxWidth: 600 },
  privacyCard: {
    flexDirection: 'row',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: 22,
  },
  privacyDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  privacyCopy: { flex: 1, gap: Spacing.one },
  resumeCard: { gap: Spacing.three, padding: Spacing.three, borderRadius: Spacing.three },
  resumeButton: {
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  discardButton: { alignItems: 'center', paddingVertical: Spacing.one },
  backupProgressCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  resultCount: { minWidth: 54, fontSize: 32, lineHeight: 38, fontWeight: '800' },
  resultCopy: { flex: 1, gap: Spacing.one },
  resultsSection: { gap: Spacing.three },
  scanSummaryCard: {
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
    borderRadius: Spacing.three,
  },
  scanSummaryMark: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanSummaryMarkText: { fontSize: 28, lineHeight: 34, fontWeight: '800' },
  scanSummaryCopy: { textAlign: 'center', maxWidth: 520 },
  detailsButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  analysisCard: { gap: Spacing.three, padding: Spacing.three, borderRadius: Spacing.three },
  analysisHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.three,
  },
  analysisCount: { fontSize: 32, lineHeight: 38, fontWeight: '800' },
  analysisBreakdown: { flexDirection: 'row', gap: Spacing.two },
  analysisMetric: {
    flex: 1,
    gap: Spacing.half,
    padding: Spacing.two,
    borderRadius: Spacing.two,
  },
  deltaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  deltaMetric: {
    minWidth: 112,
    flexGrow: 1,
    gap: Spacing.half,
    padding: Spacing.two,
    borderRadius: Spacing.two,
  },
  reviewButton: {
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  messageCard: {
    gap: Spacing.two,
    borderLeftWidth: 3,
    paddingVertical: Spacing.two,
    paddingLeft: Spacing.three,
  },
  actionArea: { gap: Spacing.two },
  primaryButton: {
    minHeight: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  buttonMuted: { opacity: 0.58 },
  buttonText: { color: '#FFFFFF', fontSize: 17, lineHeight: 22, fontWeight: '700' },
  actionHint: { textAlign: 'center' },
  developerButton: { alignItems: 'center', paddingVertical: Spacing.two },
});
