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

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { useDeviceContactScan } from './use-device-contact-scan';

export function DeviceContactScanScreen() {
  const theme = useTheme();
  const { state, scan } = useDeviceContactScan();
  const isScanning = state.status === 'scanning';
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

            {state.status === 'success' && (
              <View style={[styles.resultCard, { borderColor: theme.success }]}>
                <ThemedText style={[styles.resultCount, { color: theme.success }]}>
                  {state.snapshot.contacts.length}
                </ThemedText>
                <View style={styles.resultCopy}>
                  <ThemedText type="smallBold">Contacts imported</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Ready for local analysis. No changes have been made.
                  </ThemedText>
                </View>
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

            <View style={styles.actionArea}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Scan device contacts"
                disabled={isScanning || isWeb}
                onPress={() => void scan()}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: theme.primary },
                  (pressed || isScanning || isWeb) && styles.buttonMuted,
                ]}>
                {isScanning ? (
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
});
