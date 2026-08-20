import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { manageCleanupWorkflow } from '@/composition/cleanup-workflow';
import { isPerChangeCleanupWorkflow } from '@/application';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import type { CleanupWorkflow, ProposedChange } from '@/domain';
import { useTheme } from '@/hooks/use-theme';

interface ActivityItem {
  readonly id: string;
  readonly workflowId: string;
  readonly workflowPhase: CleanupWorkflow['phase'];
  readonly completedAt: string;
  readonly backupId: string;
  readonly change: ProposedChange;
  readonly independentlyJournaled: boolean;
  readonly undoTransaction: boolean;
}

function title(change: ProposedChange, undoTransaction: boolean): string {
  if (undoTransaction) {
    if (change.kind === 'merge') return `Undid merge of ${change.before.length} contacts`;
    if (change.kind === 'delete') return `Restored ${change.before.displayName || 'unnamed contact'}`;
    return `Undid update to ${change.before.displayName || 'unnamed contact'}`;
  }
  if (change.kind === 'merge') return `Merged ${change.before.length} contacts`;
  if (change.kind === 'delete') return `Deleted ${change.before.displayName || 'unnamed contact'}`;
  return `Updated ${change.before.displayName || 'unnamed contact'}`;
}

function resultName(change: ProposedChange): string {
  return change.kind === 'delete' ? 'Contact removed' : change.after.displayName || 'Unnamed contact';
}

function phaseLabel(phase: CleanupWorkflow['phase']): string {
  if (phase === 'rolled-back') return 'Rolled back';
  if (phase === 'preflighted' || phase === 'reviewing') return 'Ready to resume';
  if (phase === 'failed') return 'Needs attention';
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

export function TransactionActivityScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [items, setItems] = useState<readonly ActivityItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const workflows = await Promise.all(
          (await manageCleanupWorkflow.listHistory()).map(({ id }) => manageCleanupWorkflow.load(id)),
        );
        const activity = workflows
          .filter((workflow): workflow is CleanupWorkflow => Boolean(workflow))
          .filter((workflow) =>
            isPerChangeCleanupWorkflow(workflow) ||
            workflow.phase === 'completed' ||
            workflow.phase === 'rolled-back',
          )
          .flatMap((workflow) => workflow.changeSet.changes
            .filter(({ decision }) => decision === 'accepted')
            .map((change): ActivityItem => ({
              id: `${workflow.id}:${change.id}`,
              workflowId: workflow.id,
              workflowPhase: workflow.phase,
              completedAt: workflow.updatedAt,
              backupId: workflow.backupId,
              change,
              independentlyJournaled: isPerChangeCleanupWorkflow(workflow),
              undoTransaction: workflow.changeSet.id.includes(':undo:transaction:'),
            })))
          .sort((left, right) => right.completedAt.localeCompare(left.completedAt));
        if (active) setItems(activity);
      } catch {
        if (active) setLoadError(true);
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        <FlatList
          data={items}
          keyExtractor={({ id }) => id}
          contentContainerStyle={styles.content}
          ListHeaderComponent={(
            <View style={styles.header}>
              <Pressable onPress={() => router.back()} hitSlop={12}>
                <ThemedText type="smallBold" style={{ color: theme.primary }}>Back</ThemedText>
              </Pressable>
              <ThemedText type="title">Activity</ThemedText>
              <ThemedText themeColor="textSecondary">
                Encrypted, on-device records of verified contact changes. Each accepted change is shown separately.
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Completed independent transactions show a red Preview Undo action below their details.
              </ThemedText>
            </View>
          )}
          ListEmptyComponent={isLoading ? (
            <ActivityIndicator color={theme.primary} />
          ) : (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">{loadError ? 'Activity unavailable' : 'No completed changes yet'}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {loadError ? 'Encrypted activity could not be opened.' : 'Verified changes will appear here.'}
              </ThemedText>
            </ThemedView>
          )}
          renderItem={({ item }) => (
            <ThemedView type="backgroundElement" style={styles.card}>
              <View style={styles.row}>
                <ThemedText type="smallBold">{title(item.change, item.undoTransaction)}</ThemedText>
                <ThemedText type="smallBold" themeColor={item.workflowPhase === 'completed' ? 'success' : 'textSecondary'}>
                  {phaseLabel(item.workflowPhase)}
                </ThemedText>
              </View>
              <ThemedText>{resultName(item.change)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {new Date(item.completedAt).toLocaleString()}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                Backup {item.backupId}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {item.undoTransaction
                  ? 'Independent Undo journal with verified inverse writes.'
                  : item.independentlyJournaled
                  ? 'Independent journal ready. Undo requires the remaining freshness and dependency checks.'
                  : 'Legacy batch record. Undo cannot target this change independently.'}
              </ThemedText>
              {item.independentlyJournaled && !item.undoTransaction && item.workflowPhase === 'completed' && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: '/undo' as never, params: { workflowId: item.workflowId } })}
                  style={[styles.undoButton, { borderColor: theme.danger }]}>
                  <ThemedText type="smallBold" themeColor="danger">Preview Undo</ThemedText>
                </Pressable>
              )}
              {!item.independentlyJournaled && item.workflowPhase === 'completed' && (
                <ThemedView style={styles.legacyNotice}>
                  <ThemedText type="smallBold" themeColor="textSecondary">Undo unavailable for this legacy batch</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    This older journal combined multiple changes, so one change cannot be safely reversed independently.
                  </ThemedText>
                </ThemedView>
              )}
            </ThemedView>
          )}
        />
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
  header: { gap: Spacing.three, marginBottom: Spacing.one },
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  undoButton: { minHeight: 44, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  legacyNotice: { paddingTop: Spacing.one, gap: Spacing.one },
});
