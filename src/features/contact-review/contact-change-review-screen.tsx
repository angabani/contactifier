import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
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
import {
  createDryRunContactWritePlan,
  type ChangeDecision,
  type ChangeSet,
  type CleanupWorkflow,
  type CanonicalContact,
  type ContactWritePlan,
  type ProposedChange,
} from '@/domain';
import { prepareDeviceContactWrite } from '@/composition/device-contact-scan';
import { manageCleanupWorkflow } from '@/composition/cleanup-workflow';
import { useDeviceContactScanSession } from '@/features/contact-import/use-device-contact-scan';
import { useTheme } from '@/hooks/use-theme';

import { contactReviewValues } from './contact-change-presentation';

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

function ContactDetails({ contact }: { readonly contact: CanonicalContact }) {
  const values = contactReviewValues(contact);
  return (
    <View style={styles.contactSummary}>
      <ThemedText type="smallBold">{contact.displayName || 'Unnamed contact'}</ThemedText>
      {values.length > 0 ? values.map((item) => (
        <View key={item.id} style={styles.contactValueRow}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.contactValueLabel}>
            {item.label}
          </ThemedText>
          <ThemedText type="small" selectable style={styles.contactValue}>
            {item.value}
          </ThemedText>
        </View>
      )) : (
        <ThemedText type="small" themeColor="textSecondary">No phone numbers or emails</ThemedText>
      )}
    </View>
  );
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
            <ContactDetails key={contact.id} contact={contact} />
          ))}
        </View>

        <View style={styles.comparisonColumn}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            RESULT
          </ThemedText>
          {after ? (
            <ContactDetails contact={after} />
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
  initialPlan,
  isDemo,
  onPrepare,
  onReview,
}: {
  readonly initialChangeSet: ChangeSet;
  readonly initialPlan?: ContactWritePlan;
  readonly isDemo: boolean;
  readonly onPrepare: (changeSet: ChangeSet) => Promise<ContactWritePlan>;
  readonly onReview: (changeSet: ChangeSet) => Promise<void>;
}) {
  const router = useRouter();
  const theme = useTheme();
  const [changeSet, setChangeSet] = useState(initialChangeSet);
  const [plan, setPlan] = useState<ContactWritePlan | null>(initialPlan ?? null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [prepareError, setPrepareError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const counts = useMemo(() => summarizeChangeDecisions(changeSet), [changeSet]);

  const decide = async (changeId: string, decision: ReviewDecision) => {
    const next = setChangeDecision(changeSet, changeId, decision);
    setIsSaving(true);
    setSaveError(false);
    setPlan(null);
    setPrepareError(false);
    try {
      await onReview(next);
      setChangeSet(next);
    } catch {
      setSaveError(true);
    } finally {
      setIsSaving(false);
    }
  };

  const prepare = async () => {
    setIsPreparing(true);
    setPrepareError(false);
    try {
      setPlan(await onPrepare(changeSet));
    } catch {
      setPlan(null);
      setPrepareError(true);
    } finally {
      setIsPreparing(false);
    }
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
        <ChangeCard
          change={item}
          onDecision={(decision) => {
            if (!isSaving) void decide(item.id, decision);
          }}
        />
      )}
      ListFooterComponent={
        changeSet.changes.length > 0 ? (
          <View style={styles.footer}>
            {plan && (
              <ThemedView type="backgroundElement" style={styles.planCard}>
                <ThemedText type="smallBold">Dry run ready</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Fresh contacts checked against the reviewed versions. No device writes occurred.
                </ThemedText>
                <View style={styles.planCounts}>
                  <ThemedText type="smallBold">{plan.createCount} create</ThemedText>
                  <ThemedText type="smallBold">{plan.updateCount} update</ThemedText>
                  <ThemedText type="smallBold">{plan.deleteCount} delete</ThemedText>
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  {plan.compensations.length} rollback steps prepared in reverse order.
                </ThemedText>
              </ThemedView>
            )}
            {prepareError && (
              <View style={[styles.prepareError, { borderColor: theme.danger }]}>
                <ThemedText type="smallBold">Dry run could not be prepared</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  A contact or backup changed after review. Scan again before continuing.
                </ThemedText>
              </View>
            )}
            {saveError && (
              <View style={[styles.prepareError, { borderColor: theme.danger }]}>
                <ThemedText type="smallBold">Decision could not be saved</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Your previous saved review is still safe. Please try that decision again.
                </ThemedText>
              </View>
            )}
            <Pressable
              accessibilityRole="button"
              disabled={
                !counts.readyToApply ||
                counts.accepted === 0 ||
                isPreparing ||
                isSaving ||
                plan !== null
              }
              onPress={() => void prepare()}
              style={[
                styles.applyButton,
                { backgroundColor: theme.primary },
                (!counts.readyToApply ||
                  counts.accepted === 0 ||
                  isPreparing ||
                  isSaving ||
                  plan !== null) &&
                  styles.disabled,
              ]}>
              {isPreparing ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <ThemedText style={styles.applyText}>
                  {plan ? 'Dry run prepared' : 'Prepare dry run'}
                </ThemedText>
              )}
            </Pressable>
            <ThemedText type="small" themeColor="textSecondary" style={styles.footerNote}>
              Review every suggestion and accept at least one. Actual contact writes remain disabled.
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
  const generatedChangeSet = useMemo(
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
  const [workflow, setWorkflow] = useState<CleanupWorkflow | null>(null);
  const [isLoadingWorkflow, setIsLoadingWorkflow] = useState(true);
  const [workflowLoadError, setWorkflowLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      setIsLoadingWorkflow(true);
      setWorkflowLoadError(false);
      try {
        const resumable = await manageCleanupWorkflow.listResumable();
        for (const item of resumable) {
          const saved = await manageCleanupWorkflow.load(item.id);
          if (
            saved &&
            (state.status !== 'success' ||
              (saved.snapshotId === state.snapshot.id && saved.backupId === state.backup.id))
          ) {
            if (active) setWorkflow(saved);
            return;
          }
        }
        if (state.status === 'success' && state.mode === 'device' && generatedChangeSet) {
          const started = await manageCleanupWorkflow.start({
            source: state.snapshot.source,
            snapshotId: state.snapshot.id,
            backupId: state.backup.id,
            changeSet: generatedChangeSet,
          });
          if (active) setWorkflow(started);
        }
      } catch {
        if (active && !(state.status === 'success' && state.mode === 'demo')) {
          setWorkflowLoadError(true);
        }
      } finally {
        if (active) setIsLoadingWorkflow(false);
      }
    };
    void initialize();
    return () => {
      active = false;
    };
  }, [generatedChangeSet, state]);

  const changeSet = workflow?.changeSet ?? generatedChangeSet;
  const saveReview = async (reviewedChangeSet: ChangeSet): Promise<void> => {
    if (!workflow) return;
    setWorkflow(await manageCleanupWorkflow.review(workflow, reviewedChangeSet));
  };
  const prepare = async (reviewedChangeSet: ChangeSet): Promise<ContactWritePlan> => {
    if (state.status !== 'success') throw new Error('Scan session is unavailable.');
    if (state.mode === 'demo') {
      return createDryRunContactWritePlan({
        analyzedSnapshot: state.snapshot,
        freshSnapshot: state.snapshot,
        backup: state.backup,
        changeSet: reviewedChangeSet,
        plannedAt: state.snapshot.createdAt,
      });
    }
    const plan = await prepareDeviceContactWrite.execute({
      analyzedSnapshot: state.snapshot,
      backup: state.backup,
      changeSet: reviewedChangeSet,
    });
    if (workflow) setWorkflow(await manageCleanupWorkflow.preflight(workflow, plan));
    return plan;
  };

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        {isLoadingWorkflow ? (
          <View style={styles.missingState}>
            <ActivityIndicator color={theme.primary} />
            <ThemedText themeColor="textSecondary">Loading your saved review…</ThemedText>
          </View>
        ) : workflowLoadError ? (
          <View style={styles.missingState}>
            <ThemedText type="subtitle">Saved review unavailable</ThemedText>
            <ThemedText themeColor="textSecondary">
              Contactifier could not safely open encrypted review progress. Your contacts were not
              changed. Return to the scan and try again.
            </ThemedText>
            <Pressable onPress={() => router.replace('/')}>
              <ThemedText type="smallBold" style={{ color: theme.primary }}>
                Return to scan
              </ThemedText>
            </Pressable>
          </View>
        ) : changeSet ? (
          <ReadyReview
            initialChangeSet={changeSet}
            initialPlan={workflow?.writePlan}
            isDemo={state.status === 'success' && state.mode === 'demo'}
            onPrepare={prepare}
            onReview={saveReview}
          />
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
  contactValueRow: { gap: 2 },
  contactValueLabel: { textTransform: 'uppercase', fontSize: 10, lineHeight: 14 },
  contactValue: { flexShrink: 1 },
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
  planCard: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  planCounts: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  prepareError: {
    borderLeftWidth: 3,
    paddingLeft: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.one,
  },
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
