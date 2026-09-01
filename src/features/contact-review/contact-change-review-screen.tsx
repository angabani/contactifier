import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import * as Device from 'expo-device';
import { Contact } from 'expo-contacts';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  createBeautificationChangeSet,
  carryForwardChangeDecisions,
  createContactWriteConfirmation,
  acceptedConfirmationTypes,
  defaultContactConfirmationPreferences,
  isPerChangeCleanupWorkflow,
  requiresContactConfirmation,
  resolveMergeConflict,
  decorateProposedContact,
  getCompletedTransactionResultContactId,
  setChangeDecision,
  summarizeChangeDecisions,
  type ReviewDecision,
  type ContactConfirmationPreferences,
  type ContactConfirmationType,
} from '@/application';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import {
  createDryRunContactWritePlan,
  findMergeConflicts,
  type ChangeDecision,
  type ChangeSet,
  type CleanupWorkflow,
  type CanonicalContact,
  type ContactWritePlan,
  type ProposedChange,
  type MergeConflictField,
  type ContactDecoration,
} from '@/domain';
import { prepareDeviceContactWrite } from '@/composition/device-contact-scan';
import { manageCleanupWorkflow } from '@/composition/cleanup-workflow';
import { contactConfirmationPreferences } from '@/composition/contact-confirmation-preferences';
import {
  executeSimulatorFixtureTransactions,
  executeSimulatorFixtureWrite,
  recoverInterruptedSimulatorFixtureWrite,
  resumeSimulatorFixtureVerification,
  resumeSimulatorFixtureFinalization,
  type SimulatorTransactionBatchResult,
} from '@/composition/simulator-contact-write';
import { useDeviceContactScanSession } from '@/features/contact-import/use-device-contact-scan';
import { useTheme } from '@/hooks/use-theme';

import { contactReviewValues, createMergePreviewPresentation } from './contact-change-presentation';

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

function completedTransactionTitle(workflow: CleanupWorkflow): string {
  const change = workflow.changeSet.changes.find(({ decision }) => decision === 'accepted');
  if (!change) return 'Completed contact change';
  if (change.kind === 'merge') return `Merged ${change.before.length} contacts`;
  if (change.kind === 'delete') return `Deleted ${change.before.displayName || 'unnamed contact'}`;
  return `Updated ${change.before.displayName || 'unnamed contact'}`;
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
  onResolveConflict,
  onDecorate,
}: {
  readonly change: ProposedChange;
  readonly onDecision: (decision: ReviewDecision) => void;
  readonly onResolveConflict: (field: MergeConflictField, sourceContactId: string) => void;
  readonly onDecorate: (decoration?: ContactDecoration) => Promise<void>;
}) {
  const theme = useTheme();
  const [mergePreviewMode, setMergePreviewMode] = useState<'sources' | 'merged' | 'changes'>(() =>
    change.kind === 'merge' && findMergeConflicts(change.before).length > 0 ? 'changes' : 'merged');
  const [decorationKind, setDecorationKind] = useState<ContactDecoration['kind']>(
    change.decoration?.kind ?? 'honorific');
  const [decorationValue, setDecorationValue] = useState(change.decoration?.value ?? '');
  const [decorationError, setDecorationError] = useState<string | null>(null);
  const [showDecorationEditor, setShowDecorationEditor] = useState(Boolean(change.decoration));
  const before = change.kind === 'merge' ? change.before : [change.before];
  const after = change.kind === 'delete' ? undefined : change.after;

  if (change.kind === 'merge') {
    const initial = (change.after.name?.givenName ?? change.after.displayName ?? '?')
      .trim().charAt(0).toLocaleUpperCase();
    const preview = createMergePreviewPresentation({ sources: change.before, result: change.after });
    const mergedValues = preview.values;
    const conflicts = findMergeConflicts(change.before);
    const unresolvedConflictCount = conflicts.filter(
      ({ field }) => !change.resolvedConflictFields?.includes(field),
    ).length;
    return (
      <ThemedView style={styles.mergeCard}>
        <View style={styles.mergeHero}>
          <ThemedText type="smallBold" themeColor="textSecondary">MERGE CONTACT</ThemedText>
          <View style={[styles.avatar, { backgroundColor: theme.primarySoft }]}>
            <ThemedText style={[styles.avatarText, { color: theme.primary }]}>{initial}</ThemedText>
          </View>
          <ThemedText type="subtitle" style={styles.mergeName}>{change.after.displayName}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {change.reasons.join(' · ')} · {Math.round(change.confidence * 100)}% confidence
          </ThemedText>
        </View>

        <View style={styles.previewModes}>
          {(['sources', 'merged', 'changes'] as const).map((mode) => {
            const selected = mergePreviewMode === mode;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={mode}
                onPress={() => setMergePreviewMode(mode)}
                style={[styles.previewMode, selected && { backgroundColor: theme.backgroundSelected }]}>
                <ThemedText type="smallBold" style={selected ? { color: theme.primary } : undefined}>
                  {mode === 'sources' ? 'Sources' : mode === 'merged' ? 'Merged' : 'Changes'}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>

        {mergePreviewMode === 'sources' && <View style={styles.nativeSection}>
          <ThemedText type="subtitle" themeColor="textSecondary">Duplicate contacts found</ThemedText>
          <ThemedView type="backgroundElement" style={styles.nativeGroup}>
            {preview.sources.map(({ contact, values }, index) => (
              <View key={contact.id} style={[styles.sourceDetail, index > 0 && styles.nativeDivider]}>
                <View style={styles.sourceCopy}>
                  <ThemedText type="smallBold">{contact.displayName || 'Unnamed contact'}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {contact.recordRef.source.kind === 'device' ? 'iPhone' : contact.recordRef.source.kind}
                  </ThemedText>
                  {values.map((value) => (
                    <View key={value.id} style={styles.sourceValue}>
                      <ThemedText selectable>{value.value}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">{value.label}</ThemedText>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </ThemedView>
        </View>}

        {mergePreviewMode === 'merged' && <View style={styles.nativeSection}>
          <View style={styles.sectionHeadingRow}>
            <ThemedText type="subtitle" themeColor="textSecondary">Merged contact information</ThemedText>
            <ThemedText type="smallBold" style={{ color: theme.primary }}>All values</ThemedText>
          </View>
          <ThemedView type="backgroundElement" style={styles.nativeGroup}>
            {mergedValues.length > 0 ? mergedValues.map((item, index) => (
              <View key={item.id} style={[styles.mergedValueRow, index > 0 && styles.nativeDivider]}>
                <ThemedText selectable>{item.value}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{item.label}</ThemedText>
              </View>
            )) : (
              <ThemedText type="small" themeColor="textSecondary">No phone numbers or emails</ThemedText>
            )}
          </ThemedView>
        </View>}

        {mergePreviewMode === 'changes' && <View style={styles.nativeSection}>
          <ThemedText type="subtitle" themeColor="textSecondary">How values will change</ThemedText>
          <ThemedView type="backgroundElement" style={styles.nativeGroup}>
            {mergedValues.map((item, index) => (
              <View key={item.id} style={[styles.changeValueRow, index > 0 && styles.nativeDivider]}>
                <View style={styles.sourceCopy}>
                  <ThemedText selectable>{item.value}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    From {item.sourceNames.join(', ') || 'the proposed result'}
                  </ThemedText>
                </View>
                <ThemedText type="smallBold" style={{ color: theme.primary }}>
                  {item.status === 'duplicate-collapsed' ? 'Duplicate collapsed' : item.status === 'added' ? 'Added' : 'Kept'}
                </ThemedText>
              </View>
            ))}
          </ThemedView>
          {conflicts.map((conflict) => (
            <View key={conflict.field} style={styles.conflictSection}>
              <ThemedText type="smallBold" themeColor={change.resolvedConflictFields?.includes(conflict.field) ? 'success' : 'danger'}>
                {conflict.title}{change.resolvedConflictFields?.includes(conflict.field) ? ' · Resolved' : ' · Selection required'}
              </ThemedText>
              <ThemedView type="backgroundElement" style={styles.nativeGroup}>
                {conflict.options.map((option, index) => {
                  const source = change.before.find(({ id }) => id === option.sourceContactId);
                  const selected = Boolean(
                    change.resolvedConflictFields?.includes(conflict.field) && source &&
                    (conflict.field === 'name'
                      ? source.displayName === change.after.displayName && JSON.stringify(source.name) === JSON.stringify(change.after.name)
                      : JSON.stringify(source.organizations) === JSON.stringify(change.after.organizations)),
                  );
                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      key={option.sourceContactId}
                      onPress={() => onResolveConflict(conflict.field, option.sourceContactId)}
                      style={[styles.conflictOption, index > 0 && styles.nativeDivider]}>
                      <View style={styles.sourceCopy}>
                        <ThemedText type="smallBold">{option.displayValue}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">From {option.sourceName}</ThemedText>
                      </View>
                      <ThemedText type="smallBold" style={{ color: selected ? theme.primary : theme.backgroundSelected }}>
                        {selected ? '✓' : '○'}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </ThemedView>
            </View>
          ))}
        </View>}

        <View style={styles.decorationSection}>
          <Pressable accessibilityRole="button" onPress={() => setShowDecorationEditor((visible) => !visible)}>
            <ThemedText type="smallBold" style={{ color: theme.primary }}>
              {showDecorationEditor ? 'Hide optional details' : change.decoration ? 'Edit optional details' : 'Add optional details'}
            </ThemedText>
          </Pressable>
          {showDecorationEditor && <>
          <ThemedText type="subtitle" themeColor="textSecondary">Contact decoration</ThemedText>
          <View style={styles.decorationKinds}>
            {(['honorific', 'company', 'designation', 'visible-name-tag'] as const).map((kind) => (
              <Pressable key={kind} onPress={() => { setDecorationKind(kind); setDecorationError(null); }}
                style={[styles.decorationKind, { borderColor: decorationKind === kind ? theme.primary : theme.backgroundSelected }]}>
                <ThemedText type="smallBold" style={decorationKind === kind ? { color: theme.primary } : undefined}>
                  {kind === 'visible-name-tag' ? 'Name tag' : kind[0].toUpperCase() + kind.slice(1)}
                </ThemedText>
              </Pressable>
            ))}
          </View>
          <TextInput
            accessibilityLabel="Decoration value"
            value={decorationValue}
            onChangeText={setDecorationValue}
            placeholder={decorationKind === 'honorific' ? 'Dr., Mr., Ms., Prof.' : 'Enter value'}
            placeholderTextColor={theme.textSecondary}
            style={[styles.decorationInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
          />
          {decorationKind === 'visible-name-tag' && <ThemedText type="small" themeColor="danger">
            A visible tag may affect contact sorting, search, caller identification, and sync behavior.
          </ThemedText>}
          {decorationError && <ThemedText type="small" themeColor="danger">{decorationError}</ThemedText>}
          <View style={styles.decorationActions}>
            <Pressable disabled={!decorationValue.trim()} onPress={() => {
              setDecorationError(null);
              void onDecorate({ kind: decorationKind, value: decorationValue }).catch((error) =>
                setDecorationError(error instanceof Error ? error.message : 'Decoration could not be applied.'));
            }} style={[styles.decorationApply, { backgroundColor: theme.primary }, !decorationValue.trim() && styles.disabled]}>
              <ThemedText type="smallBold" style={styles.selectedDecisionText}>Apply decoration</ThemedText>
            </Pressable>
            {change.decoration && <Pressable onPress={() => void onDecorate(undefined)}>
              <ThemedText type="smallBold" style={{ color: theme.primary }}>Remove</ThemedText>
            </Pressable>}
          </View>
          </>}
        </View>

        <View style={styles.mergeActions}>
          <Pressable
            accessibilityRole="button"
            disabled={unresolvedConflictCount > 0}
            onPress={() => onDecision('accepted')}
            style={[styles.mergePrimaryButton, { backgroundColor: theme.primary }, unresolvedConflictCount > 0 && styles.disabled]}>
            <ThemedText style={styles.selectedDecisionText}>Merge</ThemedText>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => onDecision('rejected')} style={styles.mergeTextButton}>
            <ThemedText type="smallBold" style={{ color: theme.primary }}>Ignore</ThemedText>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => onDecision('skipped')} style={styles.mergeTextButton}>
            <ThemedText type="smallBold" themeColor="textSecondary">Decide later</ThemedText>
          </Pressable>
        </View>
      </ThemedView>
    );
  }

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

function ExecutionConfirmationSheet({
  visible,
  confirmation,
  isExecuting,
  onCancel,
  onConfirm,
}: {
  readonly visible: boolean;
  readonly confirmation: ReturnType<typeof createContactWriteConfirmation>;
  readonly isExecuting: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const theme = useTheme();
  const row = (label: string, value: number, danger = false) => (
    <View style={styles.confirmationRow}>
      <ThemedText themeColor="textSecondary">{label}</ThemedText>
      <ThemedText type="smallBold" themeColor={danger ? 'danger' : 'text'}>{value}</ThemedText>
    </View>
  );
  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible={visible}
      onRequestClose={onCancel}>
      <ThemedView style={styles.confirmationScreen}>
        <SafeAreaView style={styles.confirmationSafeArea}>
          <View style={styles.confirmationHeader}>
            <Pressable accessibilityRole="button" disabled={isExecuting} onPress={onCancel}>
              <ThemedText type="smallBold" style={{ color: theme.primary }}>Cancel</ThemedText>
            </Pressable>
            <ThemedText type="subtitle">Confirm changes</ThemedText>
            <View style={styles.confirmationHeaderSpacer} />
          </View>
          <View style={styles.confirmationContent}>
            <ThemedText type="title">Ready to update Contacts?</ThemedText>
            <ThemedText themeColor="textSecondary">
              Review the exact merged results on the previous screen. Each accepted change will run
              as an independently verified transaction.
            </ThemedText>
            <ThemedView type="backgroundElement" style={styles.confirmationCard}>
              {row('Accepted transactions', confirmation.acceptedTransactionCount)}
              {row('Contacts to create', confirmation.createCount)}
              {row('Contacts to update', confirmation.updateCount)}
              {row('Contacts to delete', confirmation.deleteCount, confirmation.hasDestructiveImpact)}
              {row('Rollback steps prepared', confirmation.rollbackStepCount)}
            </ThemedView>
            <ThemedView type="backgroundElement" style={styles.confirmationCard}>
              <ThemedText
                type="smallBold"
                themeColor={confirmation.hasVerifiedBackup ? 'success' : 'danger'}>
                {confirmation.hasVerifiedBackup
                  ? 'Verified encrypted backup available'
                  : 'Verified backup unavailable'}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Contactifier will reread native results before completion. Failed transactions use
                their prepared rollback steps without reversing unrelated transactions.
              </ThemedText>
            </ThemedView>
          </View>
          <View style={styles.confirmationFooter}>
            <Pressable
              accessibilityRole="button"
              disabled={isExecuting || !confirmation.hasVerifiedBackup}
              onPress={onConfirm}
              style={[
                styles.confirmationButton,
                { backgroundColor: theme.primary },
                (isExecuting || !confirmation.hasVerifiedBackup) && styles.disabled,
              ]}>
              {isExecuting
                ? <ActivityIndicator color="#FFFFFF" />
                : <ThemedText style={styles.applyText}>Confirm and apply</ThemedText>}
            </Pressable>
            <ThemedText type="small" themeColor="textSecondary" style={styles.footerNote}>
              Confirm every time is enabled.
            </ThemedText>
          </View>
        </SafeAreaView>
      </ThemedView>
    </Modal>
  );
}

function ReadyReview({
  initialChangeSet,
  initialPlan,
  isDemo,
  onPrepare,
  onReview,
  onExecute,
  verifiedBackupId,
}: {
  readonly initialChangeSet: ChangeSet;
  readonly initialPlan?: ContactWritePlan;
  readonly isDemo: boolean;
  readonly onPrepare: (changeSet: ChangeSet) => Promise<ContactWritePlan>;
  readonly onReview: (changeSet: ChangeSet) => Promise<void>;
  readonly onExecute?: (plan: ContactWritePlan) => Promise<SimulatorTransactionBatchResult>;
  readonly verifiedBackupId?: string;
}) {
  const router = useRouter();
  const theme = useTheme();
  const { invalidateScan } = useDeviceContactScanSession();
  const [changeSet, setChangeSet] = useState(initialChangeSet);
  const [plan, setPlan] = useState<ContactWritePlan | null>(initialPlan ?? null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [prepareError, setPrepareError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const executionInFlight = useRef(false);
  const [executionResult, setExecutionResult] = useState<SimulatorTransactionBatchResult | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [isViewingContact, setIsViewingContact] = useState(false);
  const [viewContactError, setViewContactError] = useState(false);
  const [isConfirmingExecution, setIsConfirmingExecution] = useState(false);
  const [showSafetyDetails, setShowSafetyDetails] = useState(false);
  const [confirmationPreferences, setConfirmationPreferences] =
    useState<ContactConfirmationPreferences>(defaultContactConfirmationPreferences);
  const [sessionConfirmedTypes, setSessionConfirmedTypes] =
    useState<ReadonlySet<ContactConfirmationType>>(new Set());
  const [selectedMergeId, setSelectedMergeId] = useState<string | null>(null);
  const counts = useMemo(() => summarizeChangeDecisions(changeSet), [changeSet]);
  const visibleChanges = useMemo(
    () => changeSet.changes.filter(({ decision }) => decision !== 'rejected'),
    [changeSet],
  );
  const mergeChanges = useMemo(
    () => visibleChanges.filter((change): change is Extract<ProposedChange, { kind: 'merge' }> => change.kind === 'merge'),
    [visibleChanges],
  );
  const unresolvedMergeCount = mergeChanges.filter((change) => {
    const resolved = new Set(change.resolvedConflictFields ?? []);
    return findMergeConflicts(change.before).some(({ field }) => !resolved.has(field));
  }).length;
  const selectedMerge = mergeChanges.find(({ id }) => id === selectedMergeId);
  const confirmation = plan
    ? createContactWriteConfirmation({ changeSet, plan, verifiedBackupId })
    : null;
  const confirmationTypes = useMemo(() => acceptedConfirmationTypes(changeSet), [changeSet]);
  const needsExecutionConfirmation = requiresContactConfirmation({
    types: confirmationTypes,
    preferences: confirmationPreferences,
    sessionConfirmedTypes,
  });

  useEffect(() => {
    let active = true;
    void contactConfirmationPreferences.load()
      .then((value) => { if (active) setConfirmationPreferences(value); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  const listChanges = selectedMerge
    ? [selectedMerge]
    : visibleChanges.filter(({ kind }) => kind !== 'merge');

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

  const decideAllMerges = async (decision: Extract<ReviewDecision, 'accepted' | 'rejected'>) => {
    let next = changeSet;
    for (const change of mergeChanges) next = setChangeDecision(next, change.id, decision);
    setIsSaving(true);
    setSaveError(false);
    setPlan(null);
    try {
      await onReview(next);
      setChangeSet(next);
    } catch {
      setSaveError(true);
    } finally {
      setIsSaving(false);
    }
  };

  const resolveConflict = async (
    changeId: string,
    field: MergeConflictField,
    sourceContactId: string,
  ) => {
    const next = resolveMergeConflict({ changeSet, changeId, field, sourceContactId });
    setIsSaving(true);
    setSaveError(false);
    setPlan(null);
    try {
      await onReview(next);
      setChangeSet(next);
    } catch {
      setSaveError(true);
    } finally {
      setIsSaving(false);
    }
  };

  const decorate = async (changeId: string, decoration?: ContactDecoration) => {
    const next = decorateProposedContact({ changeSet, changeId, decoration });
    setPlan(null);
    await onReview(next);
    setChangeSet(next);
  };

  const prepare = async (): Promise<ContactWritePlan | null> => {
    setIsPreparing(true);
    setPrepareError(false);
    try {
      const prepared = await onPrepare(changeSet);
      setPlan(prepared);
      return prepared;
    } catch {
      setPlan(null);
      setPrepareError(true);
      return null;
    } finally {
      setIsPreparing(false);
    }
  };

  const execute = async (preparedPlan: ContactWritePlan | null = plan) => {
    if (!preparedPlan || !onExecute || executionInFlight.current) return;
    executionInFlight.current = true;
    setIsExecuting(true);
    setExecutionError(null);
    try {
      const result = await onExecute(preparedPlan);
      setExecutionResult(result);
    } catch (error) {
      setExecutionError(error instanceof Error ? error.message : 'Simulator execution failed.');
    } finally {
      executionInFlight.current = false;
      setIsExecuting(false);
    }
  };

  const continueFromReview = async () => {
    const prepared = plan ?? await prepare();
    if (!prepared || !onExecute) return;
    if (needsExecutionConfirmation) setIsConfirmingExecution(true);
    else await execute(prepared);
  };

  if (executionResult) {
    const successful = executionResult.attentionCount === 0;
    const undoableTransactions = [...executionResult.transactions]
      .filter(({ phase }) => phase === 'completed')
      .reverse();
    const latestUndoableTransaction = undoableTransactions[0];
    const resultContactId = latestUndoableTransaction
      ? getCompletedTransactionResultContactId(latestUndoableTransaction)
      : null;
    const viewResultContact = async () => {
      if (!resultContactId || isViewingContact) return;
      setIsViewingContact(true);
      setViewContactError(false);
      try {
        const changed = await new Contact(resultContactId).editWithForm();
        if (changed) invalidateScan();
      } catch {
        setViewContactError(true);
      } finally {
        setIsViewingContact(false);
      }
    };
    return (
      <ThemedView style={styles.completionScreen}>
        <SafeAreaView style={styles.completionSafeArea}>
          <View style={styles.completionContent}>
            <View style={[styles.completionMark, { backgroundColor: successful ? theme.primarySoft : theme.backgroundSelected }]}>
              <ThemedText style={[styles.completionMarkText, { color: successful ? theme.success : theme.danger }]}>
                {successful ? '✓' : '!'}
              </ThemedText>
            </View>
            <ThemedText type="title" style={styles.completionTitle}>
              {successful ? 'Contacts updated' : 'Some changes need attention'}
            </ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.completionTitle}>
              {executionResult.completedCount} verified · {executionResult.rolledBackCount} safely rolled back
              {executionResult.attentionCount > 0 ? ` · ${executionResult.attentionCount} need review` : ''}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.completionTitle}>
              Each accepted change has its own encrypted journal. Undo performs a fresh safety check before restoring anything.
            </ThemedText>
            {resultContactId && (
              <Pressable
                accessibilityRole="button"
                disabled={isViewingContact}
                onPress={() => void viewResultContact()}
                style={[styles.applyButton, { backgroundColor: theme.primary }, isViewingContact && styles.disabled]}>
                {isViewingContact
                  ? <ActivityIndicator color="#FFFFFF" />
                  : <ThemedText style={styles.applyText}>View contact</ThemedText>}
              </Pressable>
            )}
            {viewContactError && (
              <ThemedText type="small" themeColor="danger" style={styles.completionTitle}>
                The native contact could not be opened. Scan again to refresh its directory record.
              </ThemedText>
            )}
            {latestUndoableTransaction && (
              <ThemedView type="backgroundElement" style={styles.completionUndoCard}>
                <ThemedText type="subtitle">Changed contact</ThemedText>
                <ThemedText type="smallBold">{completedTransactionTitle(latestUndoableTransaction)}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">Verified and journaled</ThemedText>
                {undoableTransactions.length > 1 && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {undoableTransactions.length - 1} earlier {undoableTransactions.length === 2 ? 'change is' : 'changes are'} available in Activity.
                  </ThemedText>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Preview Undo for ${completedTransactionTitle(latestUndoableTransaction)}`}
                  onPress={() => router.push({ pathname: '/undo' as never, params: { workflowId: latestUndoableTransaction.id } })}
                  style={[styles.completionUndoButton, { borderColor: theme.danger }]}>
                  <ThemedText type="smallBold" themeColor="danger">Undo last change</ThemedText>
                </Pressable>
              </ThemedView>
            )}
            <Pressable accessibilityRole="button" onPress={() => router.push('/activity' as never)} style={styles.mergeTextButton}>
              <ThemedText type="smallBold" style={{ color: theme.primary }}>View all activity</ThemedText>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => router.replace('/')} style={styles.mergeTextButton}>
              <ThemedText type="smallBold" style={{ color: theme.primary }}>Scan again</ThemedText>
            </Pressable>
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <FlatList
      data={listChanges}
      keyExtractor={({ id }) => id}
      contentContainerStyle={styles.listContent}
      ListHeaderComponent={
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            onPress={() => selectedMergeId ? setSelectedMergeId(null) : router.back()}
            hitSlop={12}>
            <ThemedText type="smallBold" style={{ color: theme.primary }}>
              {selectedMergeId ? 'Duplicates' : 'Cancel'}
            </ThemedText>
          </Pressable>
          <ThemedText type="title" style={styles.title}>
            {selectedMerge ? 'Merge Contact' : 'Duplicates Found'}
          </ThemedText>
          <ThemedText themeColor="textSecondary">
            {selectedMerge
              ? 'Review every value that will remain before choosing Merge.'
              : 'Review duplicate groups individually or make one explicit bulk decision.'}
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
          {!selectedMerge && <ThemedView type="backgroundElement" style={styles.summary}>
            <ThemedText type="smallBold">{counts.accepted} accepted</ThemedText>
            <ThemedText type="smallBold">{counts.rejected} rejected</ThemedText>
            <ThemedText type="smallBold">{counts.skipped} later</ThemedText>
            <ThemedText type="smallBold" style={{ color: theme.primary }}>
              {counts.pending} pending
            </ThemedText>
          </ThemedView>}
          {!selectedMerge && mergeChanges.length > 0 && (
            <>
              <ThemedView type="backgroundElement" style={styles.duplicateGroup}>
                {mergeChanges.map((change, index) => (
                  <Pressable
                    accessibilityRole="button"
                    key={change.id}
                    onPress={() => setSelectedMergeId(change.id)}
                    style={[styles.duplicateRow, index > 0 && styles.nativeDivider]}>
                    <View style={styles.sourceCopy}>
                      <ThemedText type="smallBold">{change.after.displayName || 'Unnamed contact'}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {change.before.length} contact cards found
                      </ThemedText>
                    </View>
                    <ThemedText style={styles.chevron}>›</ThemedText>
                  </Pressable>
                ))}
              </ThemedView>
              <View style={styles.bulkActions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={isSaving || unresolvedMergeCount > 0}
                  onPress={() => void decideAllMerges('accepted')}
                  style={[styles.mergePrimaryButton, { backgroundColor: theme.primary }, (isSaving || unresolvedMergeCount > 0) && styles.disabled]}>
                  <ThemedText style={styles.selectedDecisionText}>Merge All</ThemedText>
                </Pressable>
                {unresolvedMergeCount > 0 && (
                  <ThemedText type="small" themeColor="danger" style={styles.footerNote}>
                    Resolve conflicts in {unresolvedMergeCount} merge{unresolvedMergeCount === 1 ? '' : 's'} before using Merge All.
                  </ThemedText>
                )}
                <Pressable
                  accessibilityRole="button"
                  disabled={isSaving}
                  onPress={() => void decideAllMerges('rejected')}
                  style={styles.mergeTextButton}>
                  <ThemedText type="smallBold" style={{ color: theme.primary }}>Ignore All</ThemedText>
                </Pressable>
              </View>
            </>
          )}
        </View>
      }
      ListEmptyComponent={visibleChanges.length === 0 ? (
        <ThemedView type="backgroundElement" style={styles.emptyCard}>
          <ThemedText type="smallBold">No changes need review</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            No pending or later suggestions remain. Rejected unchanged suggestions stay hidden.
          </ThemedText>
        </ThemedView>
      ) : null}
      renderItem={({ item }) => (
        <ChangeCard
          change={item}
          onResolveConflict={(field, sourceContactId) => {
            if (!isSaving) void resolveConflict(item.id, field, sourceContactId);
          }}
          onDecorate={(decoration) => decorate(item.id, decoration)}
          onDecision={(decision) => {
            if (!isSaving) {
              void decide(item.id, decision);
              if (item.kind === 'merge') setSelectedMergeId(null);
            }
          }}
        />
      )}
      ListFooterComponent={
        visibleChanges.length > 0 && !selectedMerge ? (
          <View style={styles.footer}>
            {plan && showSafetyDetails && (
              <ThemedView type="backgroundElement" style={styles.planCard}>
                <ThemedText type="smallBold">Safety checks complete</ThemedText>
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
            {plan && (
              <Pressable accessibilityRole="button" onPress={() => setShowSafetyDetails((visible) => !visible)}>
                <ThemedText type="smallBold" style={{ color: theme.primary, textAlign: 'center' }}>
                  {showSafetyDetails ? 'Hide safety details' : 'View safety details'}
                </ThemedText>
              </Pressable>
            )}
            {executionError && (
              <View style={[styles.prepareError, { borderColor: theme.danger }]}>
                <ThemedText type="smallBold">Simulator execution was rejected</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {executionError}
                </ThemedText>
              </View>
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
                isExecuting
              }
              onPress={() => void continueFromReview()}
              style={[
                styles.applyButton,
                { backgroundColor: theme.primary },
                (!counts.readyToApply ||
                  counts.accepted === 0 ||
                  isPreparing ||
                  isSaving ||
                  isExecuting) &&
                  styles.disabled,
              ]}>
              {isPreparing || isExecuting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <ThemedText style={styles.applyText}>Continue</ThemedText>
              )}
            </Pressable>
            <ThemedText type="small" themeColor="textSecondary" style={styles.footerNote}>
              Contactifier verifies the latest contact state and backup before showing final confirmation.
              Production and physical-device writes remain disabled.
            </ThemedText>
            {confirmation && (
              <ExecutionConfirmationSheet
                visible={isConfirmingExecution}
                confirmation={confirmation}
                isExecuting={isExecuting}
                onCancel={() => setIsConfirmingExecution(false)}
                onConfirm={() => {
                  setSessionConfirmedTypes(new Set([...sessionConfirmedTypes, ...confirmationTypes]));
                  void execute().finally(() => setIsConfirmingExecution(false));
                }}
              />
            )}
          </View>
        ) : null
      }
    />
  );
}

export function ContactChangeReviewScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { state, invalidateScan } = useDeviceContactScanSession();
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
  const [isRecoveringWrite, setIsRecoveringWrite] = useState(false);
  const recoveryInFlight = useRef(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

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
          const history: CleanupWorkflow[] = [];
          for (const summary of (await manageCleanupWorkflow.listHistory()).slice(0, 50)) {
            if (!['completed', 'failed', 'rolled-back'].includes(summary.phase)) continue;
            const saved = await manageCleanupWorkflow.load(summary.id);
            if (saved) history.push(saved);
          }
          const carriedChangeSet = carryForwardChangeDecisions(generatedChangeSet, history);
          const started = await manageCleanupWorkflow.start({
            source: state.snapshot.source,
            snapshotId: state.snapshot.id,
            backupId: state.backup.id,
            changeSet: carriedChangeSet,
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
  const execute = async (plan: ContactWritePlan): Promise<SimulatorTransactionBatchResult> => {
    if (!workflow || workflow.writePlan?.changeSetId !== plan.changeSetId) {
      throw new Error('Persisted simulator preflight is unavailable.');
    }
    const result = isPerChangeCleanupWorkflow(workflow)
      ? (() => executeSimulatorFixtureWrite(workflow).then((transaction) => ({
          transactions: [transaction],
          completedCount: transaction.phase === 'completed' ? 1 : 0,
          rolledBackCount: transaction.phase === 'rolled-back' ? 1 : 0,
          attentionCount: ['completed', 'rolled-back'].includes(transaction.phase) ? 0 : 1,
        })))()
      : executeSimulatorFixtureTransactions(workflow);
    const settled = await result;
    invalidateScan();
    return settled;
  };
  const simulatorExecutionEnabled =
    __DEV__ &&
    Platform.OS === 'ios' &&
    !Device.isDevice &&
    state.status === 'success' &&
    state.mode === 'device' &&
    workflow?.phase === 'preflighted';
  const simulatorRecoveryEnabled =
    __DEV__ && Platform.OS === 'ios' && !Device.isDevice && state.status === 'success' && state.mode === 'device';
  const recoverInterruptedWrite = async () => {
    if (!workflow || recoveryInFlight.current) return;
    recoveryInFlight.current = true;
    setIsRecoveringWrite(true);
    setRecoveryError(null);
    try {
      setWorkflow(await recoverInterruptedSimulatorFixtureWrite(workflow));
    } catch (error) {
      setRecoveryError(error instanceof Error ? error.message : 'Recovery failed unexpectedly.');
    } finally {
      recoveryInFlight.current = false;
      setIsRecoveringWrite(false);
    }
  };
  const resumeVerification = async () => {
    if (!workflow || recoveryInFlight.current) return;
    recoveryInFlight.current = true;
    const attemptedRevision = workflow.revision;
    setIsRecoveringWrite(true);
    setRecoveryError(null);
    try {
      setWorkflow(await resumeSimulatorFixtureVerification(workflow));
    } catch (error) {
      const latest = await manageCleanupWorkflow.load(workflow.id).catch(() => null);
      if (latest && latest.revision !== attemptedRevision) {
        setWorkflow(latest);
      } else {
        setRecoveryError(error instanceof Error ? error.message : 'Verification recovery failed unexpectedly.');
      }
    } finally {
      recoveryInFlight.current = false;
      setIsRecoveringWrite(false);
    }
  };
  const returnToFreshScan = () => {
    invalidateScan();
    router.replace('/');
  };
  const resumeFinalization = async () => {
    if (!workflow || recoveryInFlight.current) return;
    recoveryInFlight.current = true;
    setIsRecoveringWrite(true);
    setRecoveryError(null);
    try {
      const result = await resumeSimulatorFixtureFinalization(workflow);
      setWorkflow(result);
      if (result.phase === 'completed' || result.phase === 'rolled-back') invalidateScan();
    } catch (error) {
      setRecoveryError(error instanceof Error ? error.message : 'Finalization recovery failed unexpectedly.');
    } finally {
      recoveryInFlight.current = false;
      setIsRecoveringWrite(false);
    }
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
        ) : workflow?.phase === 'finalizing' && simulatorRecoveryEnabled ? (
          <View style={styles.missingState}>
            <ThemedText type="subtitle">Finish transaction</ThemedText>
            <ThemedText themeColor="textSecondary">
              Native verification passed. Contactifier will finish durable bookkeeping and remove
              any temporary reconciliation markers. Contact writes will not be repeated.
            </ThemedText>
            {recoveryError && <ThemedText type="small" themeColor="danger">{recoveryError}</ThemedText>}
            <Pressable accessibilityRole="button" disabled={isRecoveringWrite} onPress={() => void resumeFinalization()}
              style={[styles.applyButton, { backgroundColor: theme.primary }, isRecoveringWrite && styles.disabled]}>
              {isRecoveringWrite ? <ActivityIndicator color="#FFFFFF" /> : <ThemedText style={styles.applyText}>Finish transaction</ThemedText>}
            </Pressable>
          </View>
        ) : workflow?.phase === 'verifying' && simulatorRecoveryEnabled ? (
          <View style={styles.missingState}>
            <ThemedText type="subtitle">Finish verifying transaction</ThemedText>
            <ThemedText themeColor="textSecondary">
              All planned writes were recorded. Contactifier must verify their native results before
              it can complete the transaction or roll it back. Review decisions are locked.
            </ThemedText>
            {recoveryError && <ThemedText type="small" themeColor="danger">{recoveryError}</ThemedText>}
            <Pressable accessibilityRole="button" disabled={isRecoveringWrite} onPress={() => void resumeVerification()}
              style={[styles.applyButton, { backgroundColor: theme.primary }, isRecoveringWrite && styles.disabled]}>
              {isRecoveringWrite ? <ActivityIndicator color="#FFFFFF" /> : <ThemedText style={styles.applyText}>Resume verification</ThemedText>}
            </Pressable>
          </View>
        ) : workflow?.phase === 'applying' && simulatorRecoveryEnabled ? (
          <View style={styles.missingState}>
            <ThemedText type="subtitle">Interrupted simulator transaction</ThemedText>
            <ThemedText themeColor="textSecondary">
              Contactifier recorded a write start but not its outcome. It will reread the exact
              fixture contact before deciding whether rollback is required. The write will not be retried.
            </ThemedText>
            {recoveryError && (
              <ThemedText type="small" themeColor="danger">
                {recoveryError}
              </ThemedText>
            )}
            <Pressable
              accessibilityRole="button"
              disabled={isRecoveringWrite}
              onPress={() => void recoverInterruptedWrite()}
              style={[styles.applyButton, { backgroundColor: theme.primary }, isRecoveringWrite && styles.disabled]}>
              {isRecoveringWrite ? <ActivityIndicator color="#FFFFFF" /> : (
                <ThemedText style={styles.applyText}>Reconcile interrupted write</ThemedText>
              )}
            </Pressable>
          </View>
        ) : workflow?.phase === 'completed' ? (
          <View style={styles.missingState}>
            <ThemedText type="subtitle">Transaction completed</ThemedText>
            <ThemedText themeColor="textSecondary">
              Contactifier applied and verified {workflow.changeSet.changes.filter(({ decision }) => decision === 'accepted').length} accepted changes.
              The previous scan is now closed so it cannot be applied again.
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Your encrypted transaction journal and verified backup remain available for rollback.
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              onPress={returnToFreshScan}
              style={[styles.applyButton, { backgroundColor: theme.primary }]}>
              <ThemedText style={styles.applyText}>Scan remaining contacts</ThemedText>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => router.push('/activity' as never)}>
              <ThemedText type="smallBold" style={{ color: theme.primary }}>View activity</ThemedText>
            </Pressable>
          </View>
        ) : workflow?.phase === 'rolled-back' ? (
          <View style={styles.missingState}>
            <ThemedText type="subtitle">Interrupted transaction recovered</ThemedText>
            <ThemedText themeColor="textSecondary">
              The uncertain write was reconciled and the transaction is rolled back. This saved
              plan is closed and cannot be executed again. Scan the native directory to create a
              fresh verified backup and review.
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              onPress={returnToFreshScan}
              style={[styles.applyButton, { backgroundColor: theme.primary }]}>
              <ThemedText style={styles.applyText}>Return to scan</ThemedText>
            </Pressable>
          </View>
        ) : changeSet ? (
          <ReadyReview
            initialChangeSet={changeSet}
            initialPlan={workflow?.writePlan}
            isDemo={state.status === 'success' && state.mode === 'demo'}
            onPrepare={prepare}
            onReview={saveReview}
            onExecute={simulatorExecutionEnabled ? execute : undefined}
            verifiedBackupId={state.status === 'success' ? state.backup.id : undefined}
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
  completionScreen: { flex: 1 },
  completionSafeArea: { flex: 1 },
  completionContent: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  completionMark: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  completionMarkText: { fontSize: 42, lineHeight: 48, fontWeight: '700' },
  completionTitle: { textAlign: 'center' },
  completionUndoCard: { width: '100%', padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  completionUndoButton: { minHeight: 48, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
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
  mergeCard: { gap: Spacing.four, paddingVertical: Spacing.two },
  mergeHero: { alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.two },
  avatar: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 42, lineHeight: 50, fontWeight: '500' },
  mergeName: { textAlign: 'center', fontSize: 28, lineHeight: 34 },
  nativeSection: { gap: Spacing.two },
  previewModes: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 12,
    backgroundColor: '#E9E9EB',
  },
  previewMode: { flex: 1, minHeight: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  sectionHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  nativeGroup: { borderRadius: Spacing.three, paddingHorizontal: Spacing.three, overflow: 'hidden' },
  duplicateGroup: { borderRadius: Spacing.three, paddingHorizontal: Spacing.three, overflow: 'hidden' },
  duplicateRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  bulkActions: { gap: Spacing.one, paddingTop: Spacing.two },
  sourceRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  sourceDetail: { minHeight: 68, paddingVertical: Spacing.three },
  sourceValue: { gap: Spacing.half, paddingTop: Spacing.two },
  sourceCopy: { flex: 1, gap: Spacing.half },
  chevron: { color: '#AEAEB2', fontSize: 32, lineHeight: 34, fontWeight: '300' },
  nativeDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#C7C7CC' },
  mergedValueRow: { minHeight: 66, justifyContent: 'center', gap: Spacing.half, paddingVertical: Spacing.two },
  changeValueRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  conflictSection: { gap: Spacing.two, paddingTop: Spacing.two },
  conflictOption: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  decorationSection: { gap: Spacing.two, paddingTop: Spacing.two },
  decorationKinds: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  decorationKind: { borderWidth: 1, borderRadius: 16, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
  decorationInput: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.three, fontSize: 16 },
  decorationActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  decorationApply: { minHeight: 44, borderRadius: 12, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  mergeActions: { gap: Spacing.one, paddingTop: Spacing.one },
  mergePrimaryButton: { minHeight: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  mergeTextButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
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
  simulatorExecuteButton: {
    minHeight: 54,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#B42318',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmationScreen: { flex: 1 },
  confirmationSafeArea: { flex: 1 },
  confirmationHeader: {
    minHeight: 56,
    paddingHorizontal: Spacing.four,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  confirmationHeaderSpacer: { width: 48 },
  confirmationContent: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  confirmationCard: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  confirmationRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.three },
  confirmationFooter: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    padding: Spacing.four,
    gap: Spacing.two,
  },
  confirmationButton: { minHeight: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  footerNote: { textAlign: 'center' },
  missingState: {
    flex: 1,
    maxWidth: MaxContentWidth,
    padding: Spacing.four,
    gap: Spacing.three,
    justifyContent: 'center',
  },
});
