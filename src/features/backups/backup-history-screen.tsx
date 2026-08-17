import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { useBackupHistory } from './use-backup-history';

export function BackupHistoryScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { state, preview } = useBackupHistory();
  const backups = 'backups' in state ? state.backups : [];

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.content}>
            <Pressable onPress={() => router.back()} hitSlop={8}>
              <ThemedText type="smallBold" style={{ color: theme.primary }}>
                Back
              </ThemedText>
            </Pressable>

            <View style={styles.heading}>
              <ThemedText type="subtitle">Verified backups</ThemedText>
              <ThemedText themeColor="textSecondary">
                Preview what restoring a backup would change. Nothing is written from this screen.
              </ThemedText>
            </View>

            {state.status === 'loading' && <ActivityIndicator color={theme.primary} />}

            {state.status === 'error' && (
              <View style={[styles.messageCard, { borderColor: theme.danger }]}>
                <ThemedText type="smallBold">Backups could not be loaded</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  No contacts were changed.
                </ThemedText>
              </View>
            )}

            {state.status === 'ready' && backups.length === 0 && (
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedText type="smallBold">No verified backups yet</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Run a device contact scan to create one.
                </ThemedText>
              </ThemedView>
            )}

            {backups.map((backup) => (
              <ThemedView key={backup.id} type="backgroundElement" style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.cardCopy}>
                    <ThemedText type="smallBold">{backup.contactCount} contacts</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {new Date(backup.createdAt).toLocaleString()}
                    </ThemedText>
                  </View>
                  <ThemedText type="smallBold" style={{ color: theme.success }}>
                    Verified
                  </ThemedText>
                </View>
                <Pressable
                  disabled={state.status === 'previewing'}
                  onPress={() => void preview(backup)}
                  style={({ pressed }) => [
                    styles.previewButton,
                    { borderColor: theme.primary },
                    pressed && styles.pressed,
                  ]}>
                  <ThemedText type="smallBold" style={{ color: theme.primary }}>
                    Preview restore
                  </ThemedText>
                </Pressable>
              </ThemedView>
            ))}

            {state.status === 'previewing' && <ActivityIndicator color={theme.primary} />}

            {state.status === 'preview' && (
              <View style={[styles.previewCard, { borderColor: theme.primary }]}>
                <ThemedText type="smallBold">Restore preview</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Backup from {new Date(state.manifest.createdAt).toLocaleString()}
                </ThemedText>
                <View style={styles.metrics}>
                  <Metric label="Would update" value={state.plan.updateCount} />
                  <Metric label="Would recreate" value={state.plan.recreateCount} />
                  <Metric label="Unchanged" value={state.plan.unchangedCount} />
                  <Metric label="Unavailable" value={state.plan.unavailableCount} />
                </View>
                {state.plan.updateCount > 0 && (
                  <ThemedText type="small" themeColor="textSecondary">
                    Different fields:{' '}
                    {[
                      ...new Set(
                        state.plan.items.flatMap(({ changedFields }) => changedFields ?? []),
                      ),
                    ].join(', ')}
                  </ThemedText>
                )}
                <ThemedText type="small" themeColor="textSecondary">
                  Contacts added after this backup are left alone. Unavailable contacts are never
                  treated as deleted.
                </ThemedText>
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <View style={styles.metric}>
      <ThemedText style={styles.metricValue}>{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safeArea: { flex: 1 },
  scrollContent: { alignItems: 'center' },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
  },
  heading: { gap: Spacing.two, marginBottom: Spacing.two },
  card: { gap: Spacing.three, padding: Spacing.three, borderRadius: Spacing.three },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.three },
  cardCopy: { gap: Spacing.half },
  previewButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Spacing.three,
  },
  pressed: { opacity: 0.6 },
  previewCard: { gap: Spacing.three, borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  metric: { width: '47%', gap: Spacing.half },
  metricValue: { fontSize: 24, lineHeight: 30, fontWeight: '800' },
  messageCard: { gap: Spacing.two, borderLeftWidth: 3, paddingLeft: Spacing.three },
});
