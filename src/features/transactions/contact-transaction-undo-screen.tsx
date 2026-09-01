import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  previewContactTransactionUndo,
  type ContactTransactionUndoBlockReason,
  type ContactTransactionUndoPreview,
} from '@/application';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { manageCleanupWorkflow } from '@/composition/cleanup-workflow';
import { readDeviceContacts } from '@/composition/device-contact-scan';
import { prepareAndExecuteSimulatorFixtureUndo } from '@/composition/simulator-contact-write';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import type { CanonicalContact, CleanupWorkflow } from '@/domain';
import { useDeviceContactScanSession } from '@/features/contact-import/use-device-contact-scan';
import { useTheme } from '@/hooks/use-theme';

const reasonCopy: Record<ContactTransactionUndoBlockReason, string> = {
  'after-state-changed': 'An affected contact changed after this transaction.',
  dependency: 'A later transaction depends on one of these contacts.',
  'not-completed': 'Only completed transactions can be undone.',
  'not-independent': 'This legacy batch does not have an independent per-change journal.',
  'source-mismatch': 'The current contact directory does not match the transaction source.',
};

function ContactRestoreCard({ contact }: { readonly contact: CanonicalContact }) {
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold">{contact.displayName || 'Unnamed contact'}</ThemedText>
      {contact.phoneNumbers.map(({ id, label, value }) => (
        <ThemedText key={id} type="small">{label ?? 'phone'} · {value.raw}</ThemedText>
      ))}
      {contact.emailAddresses.map(({ id, label, value }) => (
        <ThemedText key={id} type="small">{label ?? 'email'} · {value}</ThemedText>
      ))}
    </ThemedView>
  );
}

export function ContactTransactionUndoScreen() {
  const { workflowId } = useLocalSearchParams<{ workflowId?: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { invalidateScan } = useDeviceContactScanSession();
  const [preview, setPreview] = useState<ContactTransactionUndoPreview | null>(null);
  const [workflow, setWorkflow] = useState<CleanupWorkflow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [decisionState, setDecisionState] = useState<'idle' | 'verifying' | 'completed' | 'rejected' | 'failed'>('idle');
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const verifyFresh = async (selected: CleanupWorkflow): Promise<{
    readonly snapshot: Awaited<ReturnType<typeof readDeviceContacts.execute>>;
    readonly preview: ContactTransactionUndoPreview;
  }> => {
    const [snapshot, summaries] = await Promise.all([
      readDeviceContacts.execute({ source: selected.source }),
      manageCleanupWorkflow.listHistory(),
    ]);
    const history = (await Promise.all(
      summaries.map(({ id }) => manageCleanupWorkflow.load(id)),
    )).filter((item): item is CleanupWorkflow => Boolean(item));
    return {
      snapshot,
      preview: previewContactTransactionUndo({
        workflow: selected,
        currentSnapshot: snapshot,
        laterWorkflows: history,
      }),
    };
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (!workflowId) throw new Error('Transaction id is unavailable.');
        const selected = await manageCleanupWorkflow.load(workflowId);
        if (!selected) throw new Error('Transaction is unavailable.');
        const verified = await verifyFresh(selected);
        if (!active) return;
        setWorkflow(selected);
        setPreview(verified.preview);
      } catch {
        if (active) setLoadError(true);
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => { active = false; };
  }, [workflowId]);

  const decide = async (decision: 'accept' | 'reject') => {
    if (!workflow || decisionState !== 'idle') return;
    setDecisionState('verifying');
    setDecisionError(null);
    try {
      const latest = await manageCleanupWorkflow.load(workflow.id);
      if (!latest) throw new Error('The encrypted transaction is unavailable.');
      const verified = await verifyFresh(latest);
      setPreview(verified.preview);
      if (!verified.preview.ready) {
        throw new Error('Contacts changed before confirmation. Review the refreshed safety result.');
      }
      if (decision === 'reject') {
        setDecisionState('rejected');
        return;
      }
      const result = await prepareAndExecuteSimulatorFixtureUndo(latest, verified.snapshot);
      if (result.phase === 'completed') {
        invalidateScan();
        setDecisionState('completed');
      }
      else if (result.phase === 'rolled-back') {
        setDecisionError('Undo verification failed. All inverse writes were rolled back.');
        setDecisionState('failed');
      } else {
        setDecisionError('Undo needs recovery from Activity before another contact transaction can start.');
        setDecisionState('failed');
      }
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : 'Undo could not be verified.');
      setDecisionState('failed');
    }
  };

  if (decisionState === 'completed' || decisionState === 'rejected') {
    const completed = decisionState === 'completed';
    return (
      <ThemedView style={styles.screen}>
        <SafeAreaView style={styles.resultSafeArea}>
          <ThemedView style={styles.resultContent}>
            <ThemedView
              style={[
                styles.resultMark,
                { backgroundColor: completed ? theme.primarySoft : theme.backgroundSelected },
              ]}>
              <ThemedText style={[styles.resultMarkText, { color: completed ? theme.success : theme.textSecondary }]}>
                {completed ? '✓' : '—'}
              </ThemedText>
            </ThemedView>
            <ThemedText type="title" style={styles.resultText}>
              {completed ? 'Undo completed' : 'Current contacts kept'}
            </ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.resultText}>
              {completed
                ? 'The original contact information was restored and verified in the native Contacts directory.'
                : 'Current contacts were verified and left unchanged.'}
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace('/')}
              style={[styles.primaryButton, { backgroundColor: theme.primary }]}>
              <ThemedText style={styles.primaryButtonText}>Scan contacts</ThemedText>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => router.replace('/activity')} style={styles.textButton}>
              <ThemedText type="smallBold" style={{ color: theme.primary }}>View activity</ThemedText>
            </Pressable>
          </ThemedView>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ThemedText type="smallBold" style={{ color: theme.primary }}>Back</ThemedText>
          </Pressable>
          <ThemedText type="title">Undo preview</ThemedText>
          <ThemedText themeColor="textSecondary">
            Review the original contact information that Contactifier will restore.
          </ThemedText>

          {isLoading ? <ActivityIndicator color={theme.primary} /> : loadError || !preview ? (
            <ThemedText themeColor="danger">The encrypted transaction or current contacts could not be verified.</ThemedText>
          ) : (
            <>
              <ThemedView type="backgroundElement" style={styles.summary}>
                <ThemedText type="subtitle" themeColor={preview.ready ? 'success' : 'danger'}>
                  {preview.ready ? 'Ready to undo' : 'Undo unavailable'}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {preview.contactsToRestore.length} {preview.contactsToRestore.length === 1 ? 'contact' : 'contacts'} will be restored from the verified transaction record.
                </ThemedText>
                {preview.blockReasons.map((reason) => (
                  <ThemedText key={reason} type="small" themeColor="danger">{reasonCopy[reason]}</ThemedText>
                ))}
              </ThemedView>

              <ThemedText type="subtitle">Contacts to restore</ThemedText>
              {preview.contactsToRestore.map((contact) => (
                <ContactRestoreCard key={contact.id} contact={contact} />
              ))}

              {preview.dependentWorkflowIds.length > 0 && (
                <ThemedText type="small" themeColor="textSecondary">
                  Dependent transactions: {preview.dependentWorkflowIds.join(', ')}
                </ThemedText>
              )}
              {preview.conflictingSourceContactIds.length > 0 && (
                <ThemedText type="small" themeColor="textSecondary">
                  Conflicting native records: {preview.conflictingSourceContactIds.length}
                </ThemedText>
              )}

              {decisionError && <ThemedText themeColor="danger">{decisionError}</ThemedText>}
              <Pressable
                accessibilityRole="button"
                disabled={!preview.ready || decisionState === 'verifying'}
                onPress={() => void decide('accept')}
                style={[styles.undoButton, (!preview.ready || decisionState === 'verifying') && styles.disabled]}>
                <ThemedText style={styles.undoButtonText}>
                  {decisionState === 'verifying' ? 'Checking current contacts…' : 'Undo change'}
                </ThemedText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={!preview.ready || decisionState === 'verifying'}
                onPress={() => void decide('reject')}
                style={[styles.rejectButton, { borderColor: theme.textSecondary }, (!preview.ready || decisionState === 'verifying') && styles.disabled]}>
                <ThemedText type="smallBold">Keep current contacts</ThemedText>
              </Pressable>
              <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
                Before either choice completes, Contactifier rereads the affected contacts. Undo is journaled, verified, and automatically rolled back if verification fails.
              </ThemedText>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, safeArea: { flex: 1 },
  resultSafeArea: { flex: 1 },
  resultContent: { flex: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', justifyContent: 'center', padding: Spacing.four, gap: Spacing.three },
  resultMark: { width: 76, height: 76, borderRadius: 38, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  resultMarkText: { fontSize: 42, lineHeight: 48, fontWeight: '700' },
  resultText: { textAlign: 'center' },
  primaryButton: { minHeight: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '700' },
  textButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: Spacing.four, gap: Spacing.three },
  summary: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.one },
  undoButton: { minHeight: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#B42318' },
  undoButtonText: { color: '#FFFFFF', fontWeight: '700' },
  rejectButton: { minHeight: 50, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.45 }, note: { textAlign: 'center' },
});
