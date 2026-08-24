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
import { useRouter } from 'expo-router';
import Constants, { AppOwnership } from 'expo-constants';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { useDeviceContactScanSession } from './use-device-contact-scan';

export function DeviceContactScanScreen() {
  const theme = useTheme();
  const router = useRouter();
  const {
    state,
    scan,
    loadDemo,
    resumableWorkflow,
    isResuming,
    resumeError,
    resume,
    isDiscardingWorkflow,
    discardWorkflowError,
    discardResumableWorkflow,
  } = useDeviceContactScanSession();
  const isBusy =
    state.status === 'scanning' ||
    state.status === 'backing-up' ||
    isResuming ||
    isDiscardingWorkflow;
  const isWeb = Platform.OS === 'web';
  const showIosCertification =
    __DEV__ && Platform.OS === 'ios' && Constants.appOwnership !== AppOwnership.Expo;

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          <View style={styles.content}>
            <View style={styles.topBar}>
              <View style={[styles.brandMark, { backgroundColor: theme.primarySoft }]}> 
                <ThemedText style={[styles.brandLetter, { color: theme.primary }]}>C</ThemedText>
              </View>
              {!isWeb && (
                <View style={styles.topActions}>
                  <Pressable accessibilityRole="button" onPress={() => router.push('/settings' as never)}>
                    <ThemedText type="smallBold" style={{ color: theme.primary }}>Settings</ThemedText>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open transaction activity and Undo"
                    onPress={() => router.push('/activity' as never)}
                    style={[styles.activityButton, { borderColor: theme.primary }]}>
                    <ThemedText type="smallBold" style={{ color: theme.primary }}>Activity &amp; Undo</ThemedText>
                  </Pressable>
                </View>
              )}
            </View>

            <View style={styles.heading}>
              <ThemedText style={styles.eyebrow}>CONTACTIFIER</ThemedText>
              <ThemedText type="title" style={styles.title}>
                A cleaner contact list starts here.
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.subtitle}>
                Find duplicate contacts and incomplete details before deciding what to change.
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
              <ThemedView type="backgroundElement" style={styles.backupProgressCard}>
                <ActivityIndicator color={theme.primary} />
                <View style={styles.resultCopy}>
                  <ThemedText type="smallBold">
                    {state.phase === 'encrypting' ? 'Encrypting backup' : 'Verifying backup'}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {state.completedContacts} of {state.totalContacts} contacts
                  </ThemedText>
                </View>
              </ThemedView>
            )}

            {state.status === 'success' && (
              <View style={styles.resultsSection}>
                <View style={[styles.resultCard, { borderColor: theme.success }]}>
                  <ThemedText style={[styles.resultCount, { color: theme.success }]}>
                    {state.snapshot.contacts.length}
                  </ThemedText>
                  <View style={styles.resultCopy}>
                    <ThemedText type="smallBold">Contacts imported</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {state.mode === 'demo'
                        ? 'Synthetic demo data loaded. Your real contacts were not used.'
                        : 'Encrypted backup verified. No changes have been made.'}
                    </ThemedText>
                  </View>
                </View>

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

                  {state.analysis.matches.length + state.quality.updateCount + state.quality.deleteCandidateCount > 0 && (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => router.push('/review')}
                      style={[styles.reviewButton, { backgroundColor: theme.primary }]}>
                      <ThemedText style={styles.buttonText}>Review suggested changes</ThemedText>
                    </Pressable>
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

            <View style={styles.actionArea}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Scan device contacts"
                disabled={isBusy || isWeb}
                onPress={() => void scan()}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: theme.primary },
                  (pressed || isBusy || isWeb) && styles.buttonMuted,
                ]}>
                {isBusy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <ThemedText style={styles.buttonText}>
                    {state.status === 'success' ? 'Scan again' : 'Scan device contacts'}
                  </ThemedText>
                )}
              </Pressable>

              <ThemedText type="small" themeColor="textSecondary" style={styles.actionHint}>
                {isWeb
                  ? 'Device contact scanning is available on iOS and Android.'
                  : 'You choose which suggested changes to apply.'}
              </ThemedText>
              {!isWeb && (
                <View style={styles.localDataLinks}>
                  <Pressable onPress={() => router.push('/activity' as never)} style={styles.backupsButton}>
                    <ThemedText type="smallBold" style={{ color: theme.primary }}>View activity</ThemedText>
                  </Pressable>
                  <Pressable onPress={() => router.push('/backups')} style={styles.backupsButton}>
                    <ThemedText type="smallBold" style={{ color: theme.primary }}>View verified backups</ThemedText>
                  </Pressable>
                </View>
              )}
              <Pressable
                accessibilityRole="button"
                onPress={loadDemo}
                style={[styles.demoButton, { borderColor: theme.primary }]}>
                <ThemedText type="smallBold" style={{ color: theme.primary }}>
                  Try review flow with demo data
                </ThemedText>
              </Pressable>
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
  topActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  activityButton: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMark: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandLetter: { fontSize: 30, lineHeight: 36, fontWeight: '800' },
  heading: { gap: Spacing.two },
  eyebrow: { fontSize: 12, lineHeight: 16, fontWeight: '800', letterSpacing: 1.8 },
  title: { fontSize: 40, lineHeight: 44, maxWidth: 560 },
  subtitle: { fontSize: 18, lineHeight: 27, maxWidth: 600 },
  privacyCard: {
    flexDirection: 'row',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  privacyDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  privacyCopy: { flex: 1, gap: Spacing.one },
  localDataLinks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Spacing.three },
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
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  buttonMuted: { opacity: 0.58 },
  buttonText: { color: '#FFFFFF', fontSize: 17, lineHeight: 22, fontWeight: '700' },
  actionHint: { textAlign: 'center' },
  backupsButton: { alignItems: 'center', paddingVertical: Spacing.two },
  demoButton: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  developerButton: { alignItems: 'center', paddingVertical: Spacing.two },
});
