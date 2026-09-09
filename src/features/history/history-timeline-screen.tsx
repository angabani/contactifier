import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { isPerChangeCleanupWorkflow } from '@/application';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { listContactBackups } from '@/composition/contact-backup';
import { manageCleanupWorkflow } from '@/composition/cleanup-workflow';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import type { BackupManifest, CleanupWorkflow, ProposedChange } from '@/domain';
import { useTheme } from '@/hooks/use-theme';

type TimelineItem =
  | { readonly kind: 'restore-point'; readonly id: string; readonly at: string; readonly backup: BackupManifest }
  | { readonly kind: 'change'; readonly id: string; readonly at: string; readonly workflowId: string;
      readonly phase: CleanupWorkflow['phase']; readonly change: ProposedChange; readonly canUndo: boolean };

function changeTitle(change: ProposedChange): string {
  if (change.kind === 'merge') return `Merged as ${change.after.displayName || 'one contact'}`;
  if (change.kind === 'delete') return `Removed ${change.before.displayName || 'unnamed contact'}`;
  return `Updated ${change.after.displayName || 'unnamed contact'}`;
}

function dayLabel(value: string): string {
  const date = new Date(value);
  if (date.toDateString() === new Date().toDateString()) {
    return `Today, ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export function HistoryTimelineScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [items, setItems] = useState<readonly TimelineItem[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setStatus('loading');
    try {
      const [backups, summaries] = await Promise.all([listContactBackups.execute(), manageCleanupWorkflow.listHistory()]);
      const workflows = await Promise.all(summaries.map(({ id }) => manageCleanupWorkflow.load(id)));
      const restorePoints: TimelineItem[] = backups.map((backup) => ({
        kind: 'restore-point', id: `backup:${backup.id}`, at: backup.createdAt, backup,
      }));
      const changes: TimelineItem[] = workflows
        .filter((workflow): workflow is CleanupWorkflow => Boolean(workflow))
        .flatMap((workflow) => workflow.changeSet.changes
          .filter(({ decision }) => decision === 'accepted')
          .map((change) => ({
            kind: 'change' as const, id: `change:${workflow.id}:${change.id}`, at: workflow.updatedAt,
            workflowId: workflow.id, phase: workflow.phase, change,
            canUndo: isPerChangeCleanupWorkflow(workflow) && workflow.phase === 'completed'
              && !workflow.changeSet.id.includes(':undo:transaction:'),
          })));
      setItems([...restorePoints, ...changes].sort((left, right) => right.at.localeCompare(left.at)));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => { void load(false); }, 0);
    return () => clearTimeout(timeout);
  }, [load]);

  return <ThemedView style={styles.screen}>
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <FlatList
        data={items}
        keyExtractor={({ id }) => id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={<View style={styles.header}>
          <ThemedText type="title" style={styles.title}>History</ThemedText>
          <ThemedText themeColor="textSecondary">Every protected change and restore point, newest first.</ThemedText>
        </View>}
        ListEmptyComponent={status === 'loading' ? <ActivityIndicator color={theme.primary} /> : (
          <ThemedView type="backgroundElement" style={styles.empty}>
            <ThemedText type="smallBold">{status === 'error' ? 'History is unavailable' : 'No history yet'}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {status === 'error' ? 'Nothing was changed. Try loading again.' : 'Your first scan creates a verified restore point.'}
            </ThemedText>
            {status === 'error' && <Pressable accessibilityRole="button" onPress={() => void load()}>
              <ThemedText type="smallBold" style={{ color: theme.primary }}>Try again</ThemedText>
            </Pressable>}
          </ThemedView>
        )}
        renderItem={({ item }) => <ThemedView type="backgroundElement" style={styles.card}>
          <View style={[styles.icon, { backgroundColor: item.kind === 'restore-point' ? theme.successSoft : theme.primarySoft }]}>
            <ThemedText style={{ color: item.kind === 'restore-point' ? theme.success : theme.primary }}>
              {item.kind === 'restore-point' ? '◷' : '✓'}
            </ThemedText>
          </View>
          <View style={styles.copy}>
            <ThemedText type="smallBold">
              {item.kind === 'restore-point' ? `Restore point · ${item.backup.contactCount} contacts` : changeTitle(item.change)}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{dayLabel(item.at)}</ThemedText>
            {item.kind === 'change' && item.phase !== 'completed' && <ThemedText type="small" themeColor="danger">Needs attention</ThemedText>}
          </View>
          {item.kind === 'restore-point' ? (
            <Pressable accessibilityRole="button" onPress={() => router.push('/backups')} hitSlop={10}>
              <ThemedText type="smallBold" style={{ color: theme.primary }}>Restore…</ThemedText>
            </Pressable>
          ) : item.canUndo ? (
            <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/undo' as never, params: { workflowId: item.workflowId } })} hitSlop={10}>
              <ThemedText type="smallBold" style={{ color: theme.primary }}>Undo…</ThemedText>
            </Pressable>
          ) : null}
        </ThemedView>}
      />
    </SafeAreaView>
  </ThemedView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, safeArea: { flex: 1 },
  content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: Spacing.four, gap: Spacing.two },
  header: { gap: Spacing.two, marginBottom: Spacing.three }, title: { fontSize: 36, lineHeight: 42 },
  card: { minHeight: 76, borderRadius: 18, padding: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  icon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, gap: Spacing.half }, empty: { borderRadius: 18, padding: Spacing.four, gap: Spacing.two },
});
