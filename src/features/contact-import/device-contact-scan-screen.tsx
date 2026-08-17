import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { useDeviceContactScanSession } from './use-device-contact-scan';

export function DeviceContactScanScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { state, scan, loadDemo } = useDeviceContactScanSession();
  const isBusy = state.status === 'scanning' || state.status === 'backing-up';
  const isWeb = Platform.OS === 'web';

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          <View style={styles.content}>
            <View style={[styles.brandMark, { backgroundColor: theme.primarySoft }]}>
              <ThemedText style={[styles.brandLetter, { color: theme.primary }]}>C</ThemedText>
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
                <Pressable onPress={() => router.push('/backups')} style={styles.backupsButton}>
                  <ThemedText type="smallBold" style={{ color: theme.primary }}>
                    View verified backups
                  </ThemedText>
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                onPress={loadDemo}
                style={[styles.demoButton, { borderColor: theme.primary }]}>
                <ThemedText type="smallBold" style={{ color: theme.primary }}>
                  Try review flow with demo data
                </ThemedText>
              </Pressable>
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
});
