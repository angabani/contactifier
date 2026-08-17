import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  createBeautificationChangeSet,
  setChangeDecision,
  summarizeChangeDecisions,
  type ReviewDecision,
} from '@/application';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import type { ChangeDecision, ChangeSet, ProposedChange } from '@/domain';
import { useDeviceContactScanSession } from '@/features/contact-import/use-device-contact-scan';
import { useTheme } from '@/hooks/use-theme';

const decisions: readonly ReviewDecision[] = [
  'accepted',
  'rejected',
  'skipped',
];

function decisionLabel(decision: ChangeDecision): string {
  if (decision === 'accepted') return 'Accept';
  if (decision === 'rejected') return 'Reject';
  if (decision === 'skipped') return 'Later';
  return 'Pending';
}

function changeTitle(change: ProposedChange): string {
  if (change.kind === 'merge') return `Merge ${change.before.length} contacts`;
  if (change.kind === 'delete') return `Delete ${change.before.displayName}`;
  return `Update ${change.before.displayName}`;
}

function ChangeCard({
  change,
  onDecision,
}: {
  readonly change: ProposedChange;
  readonly onDecision: (decision: ReviewDecision) => void;
}) {
  const theme = useTheme();
  const before = change.kind === 'merge' ? change.before : [change.before];
  const after = change.kind === 'delete' ? undefined : change.after;

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeading}>
          <ThemedText type="smallBold">{changeTitle(change)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {change.reasons.join(' · ')} · {Math.round(change.confidence * 100)}% confidence
          </ThemedText>
        </View>
        <ThemedText type="smallBold" style={{ color: theme.primary }}>
          {decisionLabel(change.decision)}
        </ThemedText>
      </View>

      <View style={styles.comparison}>
        <View style={styles.comparisonColumn}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            CURRENT
          </ThemedText>
          {before.map((contact) => (
            <View key={contact.id} style={styles.contactSummary}>
              <ThemedText type="smallBold">{contact.displayName || 'Unnamed contact'}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {contact.phoneNumbers.length} phones · {contact.emailAddresses.length} emails
              </ThemedText>
            </View>
          ))}
        </View>

        <View style={styles.comparisonColumn}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            RESULT
          </ThemedText>
          {after ? (
            <View style={styles.contactSummary}>
              <ThemedText type="smallBold">{after.displayName || 'Unnamed contact'}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {after.phoneNumbers.length} phones · {after.emailAddresses.length} emails
              </ThemedText>
            </View>
          ) : (
            <ThemedText type="small" themeColor="danger">
              Contact will be removed
            </ThemedText>
          )}
        </View>
      </View>

      <View style={styles.decisionRow}>
        {decisions.map((decision) => {
          const selected = change.decision === decision;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected }}
              key={decision}
              onPress={() => onDecision(decision)}
              style={[
                styles.decisionButton,
                {
                  backgroundColor: selected ? theme.primary : theme.background,
                  borderColor: selected ? theme.primary : theme.backgroundSelected,
                },
              ]}>
              <ThemedText
                type="smallBold"
                style={selected ? styles.selectedDecisionText : undefined}>
                {decisionLabel(decision)}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </ThemedView>
  );
}

function ReadyReview({
  initialChangeSet,
  isDemo,
}: {
  readonly initialChangeSet: ChangeSet;
  readonly isDemo: boolean;
}) {
  const router = useRouter();
  const theme = useTheme();
  const [changeSet, setChangeSet] = useState(initialChangeSet);
  const counts = useMemo(() => summarizeChangeDecisions(changeSet), [changeSet]);

  const decide = (changeId: string, decision: ReviewDecision) => {
    setChangeSet((current) => setChangeDecision(current, changeId, decision));
  };

  return (
    <FlatList
      data={changeSet.changes}
      keyExtractor={({ id }) => id}
      contentContainerStyle={styles.listContent}
      ListHeaderComponent={
        <View style={styles.header}>
          <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={12}>
            <ThemedText type="smallBold" style={{ color: theme.primary }}>
              Back
            </ThemedText>
          </Pressable>
          <ThemedText type="title" style={styles.title}>
            Review suggested changes
          </ThemedText>
          <ThemedText themeColor="textSecondary">
            Nothing changes until you review every suggestion and explicitly confirm it.
          </ThemedText>
          {isDemo && (
            <View style={[styles.demoNotice, { borderColor: theme.primary }]}>
              <ThemedText type="smallBold" style={{ color: theme.primary }}>
                Demo mode
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                These are synthetic contacts. Decisions on this screen cannot affect your device.
              </ThemedText>
            </View>
          )}
          <ThemedView type="backgroundElement" style={styles.summary}>
            <ThemedText type="smallBold">{counts.accepted} accepted</ThemedText>
            <ThemedText type="smallBold">{counts.rejected} rejected</ThemedText>
            <ThemedText type="smallBold">{counts.skipped} later</ThemedText>
            <ThemedText type="smallBold" style={{ color: theme.primary }}>
              {counts.pending} pending
            </ThemedText>
          </ThemedView>
        </View>
      }
      ListEmptyComponent={
        <ThemedView type="backgroundElement" style={styles.emptyCard}>
          <ThemedText type="smallBold">No changes need review</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            The exact duplicate scan did not create any proposals.
          </ThemedText>
        </ThemedView>
      }
      renderItem={({ item }) => (
        <ChangeCard change={item} onDecision={(decision) => decide(item.id, decision)} />
      )}
      ListFooterComponent={
        changeSet.changes.length > 0 ? (
          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              disabled
              style={[styles.applyButton, { backgroundColor: theme.primary }, styles.disabled]}>
              <ThemedText style={styles.applyText}>Apply accepted changes</ThemedText>
            </Pressable>
            <ThemedText type="small" themeColor="textSecondary" style={styles.footerNote}>
              Applying is intentionally locked until native writes and post-write verification pass
              the regression contract.
            </ThemedText>
          </View>
        ) : null
      }
    />
  );
}

export function ContactChangeReviewScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { state } = useDeviceContactScanSession();
  const changeSet = useMemo(
    () =>
      state.status === 'success'
        ? createBeautificationChangeSet({
            snapshot: state.snapshot,
            duplicateAnalysis: state.analysis,
            qualityAnalysis: state.quality,
            createdAt: state.snapshot.createdAt,
          })
        : null,
    [state],
  );

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        {changeSet ? (
          <ReadyReview initialChangeSet={changeSet} isDemo={state.status === 'success' && state.mode === 'demo'} />
        ) : (
          <View style={styles.missingState}>
            <ThemedText type="subtitle">Scan contacts first</ThemedText>
            <ThemedText themeColor="textSecondary">
              A verified scan and backup are required before suggestions can be reviewed.
            </ThemedText>
            <Pressable onPress={() => router.replace('/')}>
              <ThemedText type="smallBold" style={{ color: theme.primary }}>
                Return to scan
              </ThemedText>
            </Pressable>
          </View>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safeArea: { flex: 1 },
  listContent: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
    gap: Spacing.three,
  },
  header: { gap: Spacing.three, marginBottom: Spacing.one },
  title: { fontSize: 36, lineHeight: 42 },
  summary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  demoNotice: {
    borderLeftWidth: 3,
    paddingLeft: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.one,
  },
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.three },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.three },
  cardHeading: { flex: 1, gap: Spacing.one },
  comparison: { flexDirection: 'row', gap: Spacing.three },
  comparisonColumn: { flex: 1, gap: Spacing.two },
  contactSummary: { gap: Spacing.half },
  decisionRow: { flexDirection: 'row', gap: Spacing.two },
  decisionButton: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedDecisionText: { color: '#FFFFFF' },
  emptyCard: { padding: Spacing.four, borderRadius: Spacing.three, gap: Spacing.two },
  footer: { gap: Spacing.two, paddingTop: Spacing.two },
  applyButton: {
    minHeight: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.45 },
  applyText: { color: '#FFFFFF', fontWeight: '700' },
  footerNote: { textAlign: 'center' },
  missingState: {
    flex: 1,
    maxWidth: MaxContentWidth,
    padding: Spacing.four,
    gap: Spacing.three,
    justifyContent: 'center',
  },
});
