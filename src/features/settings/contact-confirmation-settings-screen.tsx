import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  defaultContactConfirmationPreferences,
  type ContactConfirmationPreferences,
  type ContactConfirmationType,
} from '@/application';
import { contactConfirmationPreferences } from '@/composition/contact-confirmation-preferences';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const rows: readonly { type: ContactConfirmationType; title: string; detail: string }[] = [
  { type: 'merge', title: 'Confirm merges', detail: 'Merges update one contact and remove the other source cards.' },
  { type: 'update', title: 'Confirm updates', detail: 'Includes cleanup and formatting changes.' },
  { type: 'delete', title: 'Confirm deletions', detail: 'Recommended. Turn this off only after reviewing the deletion safeguards.' },
  { type: 'restore', title: 'Confirm full restores', detail: 'Restores may recreate, update, or remove app-created copies.' },
  { type: 'undo', title: 'Confirm Undo', detail: 'Undo is itself a verified native transaction.' },
];

export function ContactConfirmationSettingsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [preferences, setPreferences] = useState<ContactConfirmationPreferences | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void contactConfirmationPreferences.load()
      .then((value) => { if (active) setPreferences(value); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);

  const update = async (type: ContactConfirmationType, enabled: boolean) => {
    if (!preferences || isSaving) return;
    const next = Object.freeze({ ...preferences, [type]: enabled });
    setIsSaving(true);
    setError(false);
    try {
      await contactConfirmationPreferences.save(next);
      setPreferences(next);
    } catch {
      setError(true);
    } finally {
      setIsSaving(false);
    }
  };

  const reset = async () => {
    setIsSaving(true);
    setError(false);
    try {
      await contactConfirmationPreferences.reset();
      setPreferences(defaultContactConfirmationPreferences);
    } catch {
      setError(true);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <Pressable accessibilityRole="button" onPress={() => router.back()}>
              <ThemedText type="smallBold" style={{ color: theme.primary }}>Done</ThemedText>
            </Pressable>
            <ThemedText type="title">Confirmations</ThemedText>
            <ThemedText themeColor="textSecondary">
              These settings only control whether Contactifier asks immediately before applying.
              All backup, freshness, journal, verification, and rollback checks remain mandatory.
            </ThemedText>
          </View>
          {!preferences ? <ActivityIndicator color={theme.primary} /> : (
            <ThemedView type="backgroundElement" style={styles.group}>
              {rows.map((row, index) => (
                <View key={row.type} style={[styles.row, index > 0 && styles.divider]}>
                  <View style={styles.copy}>
                    <ThemedText type="smallBold">{row.title}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{row.detail}</ThemedText>
                  </View>
                  <Switch
                    accessibilityLabel={row.title}
                    disabled={isSaving}
                    value={preferences[row.type]}
                    onValueChange={(enabled) => {
                      if (row.type === 'delete' && !enabled) {
                        Alert.alert(
                          'Stop confirming deletions?',
                          'Deletion previews, verified backup, journaling, verification, and Undo remain enabled, but the final confirmation sheet will be skipped.',
                          [
                            { text: 'Keep confirming', style: 'cancel' },
                            { text: 'Turn off', style: 'destructive', onPress: () => void update(row.type, false) },
                          ],
                        );
                      } else void update(row.type, enabled);
                    }}
                  />
                </View>
              ))}
            </ThemedView>
          )}
          {error && <ThemedText type="small" themeColor="danger">Preferences could not be saved. Your previous settings remain active.</ThemedText>}
          <Pressable accessibilityRole="button" disabled={isSaving} onPress={() => void reset()} style={styles.reset}>
            <ThemedText type="smallBold" style={{ color: theme.primary }}>Reset to confirm every time</ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safeArea: { flex: 1 },
  content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: Spacing.four, gap: Spacing.four },
  header: { gap: Spacing.two },
  group: { borderRadius: Spacing.three, paddingHorizontal: Spacing.three, overflow: 'hidden' },
  row: { minHeight: 84, flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#C7C7CC' },
  copy: { flex: 1, gap: Spacing.half },
  reset: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});
