import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import * as Device from 'expo-device';
import Constants, { AppOwnership } from 'expo-constants';
import { Contact } from 'expo-contacts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  createBeautificationChangeSet,
  carryForwardChangeDecisions,
  createContactWriteConfirmation,
  acceptedConfirmationTypes,
  defaultContactConfirmationPreferences,
  isPerChangeCleanupWorkflow,
  requiresContactConfirmation,
  proposeContactDeletion,
  proposeMergeGroupDeletion,
  resolveMergeConflict,
  resolveMergeConflictWithCustomName,
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
  mergeConflictResultMatchesSource,
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
import { IOS_SIMULATOR_PREPARE_SINGLE_WRITE_TOKEN } from '@/features/developer/ios-certification-policy';

import { contactReviewValues, createMergePreviewPresentation } from './contact-change-presentation';
import { isWorkflowCompatibleWithActiveScan } from './contact-review-workflow-selection';

const decisions: readonly ReviewDecision[] = [
  'accepted',
  'rejected',
  'skipped',
];

function decisionLabel(decision: ChangeDecision): string {
  if (decision === 'accepted') return 'Approve';
  if (decision === 'rejected') return 'Ignore';
  if (decision === 'skipped') return 'Later';
  return 'Pending';
}

function changeTitle(change: ProposedChange): string {
  if (change.kind === 'merge') return `Merge ${change.before.length} contacts`;
  if (change.kind === 'delete') return `Delete ${change.before.displayName}`;
  return `Update ${change.before.displayName}`;
}

function confidenceLabel(change: ProposedChange): string {
  if (change.origin === 'ml') return change.confidence >= 0.85 ? 'Smart match · Strong evidence' : 'Smart match · Review carefully';
  if (change.kind === 'merge') return 'Exact match';
  return 'Safe cleanup suggestion';
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
  onResolveCustomName,
  onProposeDeletion,
  onProposeGroupDeletion,
  onDecorate,
}: {
  readonly change: ProposedChange;
  readonly onDecision: (decision: ReviewDecision) => void;
  readonly onResolveConflict: (field: MergeConflictField, sourceContactId: string) => void;
  readonly onResolveCustomName: (displayName: string) => Promise<void>;
  readonly onProposeDeletion: (contactId: string) => void;
  readonly onProposeGroupDeletion: () => void;
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
  const [showCustomName, setShowCustomName] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customNameError, setCustomNameError] = useState<string | null>(null);
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
    const hasCustomName = !mergeConflictResultMatchesSource({
        field: 'name',
        result: change.after,
        sources: change.before,
      });
    return (
      <ThemedView style={styles.mergeCard}>
        <View style={styles.mergeHero}>
          <ThemedText type="smallBold" themeColor="textSecondary">MERGE CONTACT</ThemedText>
          <View style={[styles.avatar, { backgroundColor: theme.primarySoft }]}>
            <ThemedText style={[styles.avatarText, { color: theme.primary }]}>{initial}</ThemedText>
          </View>
          <ThemedText type="subtitle" style={styles.mergeName}>{change.after.displayName}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {confidenceLabel(change)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {change.reasons.slice(0, 2).join(' · ')}
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
                  {mode === 'sources' ? 'Sources' : mode === 'merged' ? 'Final preview' : 'Changes'}
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
                  <Pressable
                    accessibilityLabel={`Delete ${contact.displayName || 'unnamed contact'} instead of merging it`}
                    accessibilityRole="button"
                    onPress={() => onProposeDeletion(contact.id)}
                    style={styles.deleteInsteadButton}>
                    <ThemedText type="smallBold" themeColor="danger">Delete this contact instead</ThemedText>
                  </Pressable>
                </View>
              </View>
            ))}
          </ThemedView>
        </View>}

        {mergePreviewMode === 'merged' && <View style={styles.nativeSection}>
          <View style={styles.sectionHeadingRow}>
            <ThemedText type="subtitle" themeColor="textSecondary" style={styles.sectionHeading}>Final contact preview</ThemedText>
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
                      accessible
                      accessibilityLabel={`${conflict.title}: ${option.displayValue}, from ${option.sourceName}`}
                      accessibilityRole="button"
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

        <View style={styles.nameEditorSection}>
          <ThemedText type="subtitle" themeColor="textSecondary">Contact name</ThemedText>
          {!showCustomName ? (
            <ThemedView type="backgroundElement" style={styles.selectedCustomNameRow}>
              <View style={styles.sourceCopy}>
                <ThemedText type="small" themeColor="textSecondary">
                  {hasCustomName ? 'Selected name' : 'Name after merging'}
                </ThemedText>
                <ThemedText type="smallBold">{change.after.displayName || 'Unnamed contact'}</ThemedText>
              </View>
              <Pressable
                accessibilityLabel={`Rename merged contact ${change.after.displayName || 'unnamed contact'}`}
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => {
                  setCustomName(change.after.displayName);
                  setShowCustomName(true);
                  setCustomNameError(null);
                }}>
                <ThemedText type="smallBold" style={{ color: theme.primary }}>
                  {hasCustomName ? 'Edit' : 'Rename'}
                </ThemedText>
              </Pressable>
            </ThemedView>
          ) : <ThemedView type="backgroundElement" style={styles.customNameSection}>
            <TextInput
              accessibilityLabel="Custom contact name"
              autoCapitalize="words"
              autoCorrect={false}
              value={customName}
              onChangeText={(value) => { setCustomName(value); setCustomNameError(null); }}
              placeholder="Enter the final contact name"
              placeholderTextColor={theme.textSecondary}
              returnKeyType="done"
              style={[styles.decorationInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
            />
            {customNameError && <ThemedText type="small" themeColor="danger">{customNameError}</ThemedText>}
            <View style={styles.nameEditorActions}>
              <Pressable
                accessibilityRole="button"
                disabled={!customName.trim()}
                onPress={() => void onResolveCustomName(customName).then(() => {
                  setShowCustomName(false);
                  setCustomName('');
                }).catch((error) => setCustomNameError(error instanceof Error ? error.message : 'Name could not be applied.'))}
                style={[styles.decorationApply, { backgroundColor: theme.primary }, !customName.trim() && styles.disabled]}>
                <ThemedText type="smallBold" style={styles.selectedDecisionText}>Save name</ThemedText>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => { setShowCustomName(false); setCustomNameError(null); }}>
                <ThemedText type="smallBold" themeColor="textSecondary">Cancel</ThemedText>
              </Pressable>
            </View>
          </ThemedView>}
        </View>

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

        <View style={styles.finalPreviewSection}>
          <View style={styles.finalPreviewHeading}>
            <ThemedText type="subtitle">Your contact after merging</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">This is what will be saved</ThemedText>
          </View>
          <ThemedView type="backgroundElement" style={styles.finalPreviewCard}>
            <ContactDetails contact={change.after} />
          </ThemedView>
        </View>

        <View style={styles.mergeActions}>
          <Pressable
            accessibilityRole="button"
            disabled={unresolvedConflictCount > 0}
            onPress={() => onDecision('accepted')}
            style={[styles.mergePrimaryButton, { backgroundColor: theme.primary }, unresolvedConflictCount > 0 && styles.disabled]}>
            <ThemedText style={styles.selectedDecisionText}>Merge</ThemedText>
          </Pressable>
          <Pressable
            accessibilityLabel="These are different people. Keep both contacts"
            accessibilityRole="button"
            onPress={() => onDecision('rejected')}
            style={styles.notDuplicatesButton}>
            <ThemedText type="smallBold" style={{ color: theme.primary }}>These are different people</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.notDuplicatesNote}>
              Keep both contacts and mark this suggestion as not a match.
            </ThemedText>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => onDecision('skipped')} style={styles.mergeTextButton}>
            <ThemedText type="smallBold" themeColor="textSecondary">Decide later</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => Alert.alert(
              'Delete entire group?',
              `All ${change.before.length} contacts in this group will be marked for deletion. You will still see a final confirmation, and each contact can be restored from History.`,
              [
                { text: 'Cancel', style: 'cancel' },
                { text: `Delete all ${change.before.length}`, style: 'destructive', onPress: onProposeGroupDeletion },
              ],
            )}
            style={styles.deleteGroupButton}>
            <ThemedText type="smallBold" themeColor="danger">Delete entire group</ThemedText>
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
            {confidenceLabel(change)} · {change.reasons.slice(0, 2).join(' · ')}
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
      {change.kind === 'update' && !showCustomName && (
        <View style={styles.inlineRenameRow}>
          <ThemedText type="small" themeColor="textSecondary">Want a different uniform name?</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setCustomName(change.after.displayName);
              setShowCustomName(true);
              setCustomNameError(null);
            }}>
            <ThemedText type="smallBold" style={{ color: theme.primary }}>Rename</ThemedText>
          </Pressable>
        </View>
      )}
      {change.kind === 'update' && showCustomName && (
        <View style={styles.inlineNameEditor}>
          <TextInput
            accessibilityLabel="Custom contact name"
            autoCapitalize="words"
            autoCorrect={false}
            value={customName}
            onChangeText={(value) => { setCustomName(value); setCustomNameError(null); }}
            placeholder="Enter the contact name"
            placeholderTextColor={theme.textSecondary}
            returnKeyType="done"
            style={[styles.decorationInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
          />
          {customNameError && <ThemedText type="small" themeColor="danger">{customNameError}</ThemedText>}
          <View style={styles.nameEditorActions}>
            <Pressable
              accessibilityRole="button"
              disabled={!customName.trim()}
              onPress={() => void onResolveCustomName(customName).then(() => {
                setShowCustomName(false);
                setCustomName('');
              }).catch((error) => setCustomNameError(error instanceof Error ? error.message : 'Name could not be applied.'))}
              style={[styles.decorationApply, { backgroundColor: theme.primary }, !customName.trim() && styles.disabled]}>
              <ThemedText type="smallBold" style={styles.selectedDecisionText}>Save name</ThemedText>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => { setShowCustomName(false); setCustomNameError(null); }}>
              <ThemedText type="smallBold" themeColor="textSecondary">Cancel</ThemedText>
            </Pressable>
          </View>
        </View>
      )}
      {change.kind === 'update' && (
        <Pressable
          accessibilityLabel={`Delete ${change.before.displayName || 'unnamed contact'} instead`}
          accessibilityRole="button"
          onPress={() => onProposeDeletion(change.before.id)}
          style={styles.deleteInsteadButton}>
          <ThemedText type="smallBold" themeColor="danger">Delete this contact instead</ThemedText>
        </Pressable>
      )}
      {change.kind === 'delete' && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.deleteSafetyNote}>
          This only approves the deletion for the final safety check. Nothing is deleted yet, and History can restore it after applying.
        </ThemedText>
      )}
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
            <ThemedText type="title">
              Apply {confirmation.acceptedTransactionCount} approved {confirmation.acceptedTransactionCount === 1 ? 'change' : 'changes'}?
            </ThemedText>
            <ThemedText themeColor="textSecondary">
              Contactifier will update only the suggestions you approved. Everything else stays untouched.
            </ThemedText>
            <ThemedView type="backgroundElement" style={styles.confirmationCard}>
              <ThemedText type="smallBold">What will happen</ThemedText>
              {row('New contacts', confirmation.createCount)}
              {row('Contacts updated', confirmation.updateCount)}
              {row('Contacts removed', confirmation.deleteCount, confirmation.hasDestructiveImpact)}
            </ThemedView>
            <ThemedView type="backgroundElement" style={styles.confirmationCard}>
              <ThemedText
                type="smallBold"
                themeColor={confirmation.hasVerifiedBackup ? 'success' : 'danger'}>
                {confirmation.hasVerifiedBackup
                  ? 'Protected by a verified backup'
                  : 'Cannot continue without a verified backup'}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Each approved change is checked after it is applied. If a check fails, that change
                is safely rolled back without affecting the others.
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                You can review and undo completed changes later from Activity &amp; Undo.
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
                : <ThemedText style={styles.applyText}>Apply approved changes</ThemedText>}
            </Pressable>
            <ThemedText type="small" themeColor="textSecondary" style={styles.footerNote}>
              Nothing else in your contact list will be changed.
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
  autoPrepareSingleOwnedFixture,
}: {
  readonly initialChangeSet: ChangeSet;
  readonly initialPlan?: ContactWritePlan;
  readonly isDemo: boolean;
  readonly onPrepare: (changeSet: ChangeSet) => Promise<ContactWritePlan>;
  readonly onReview: (changeSet: ChangeSet) => Promise<void>;
  readonly onExecute?: (plan: ContactWritePlan) => Promise<SimulatorTransactionBatchResult>;
  readonly verifiedBackupId?: string;
  readonly autoPrepareSingleOwnedFixture?: boolean;
}) {
  const router = useRouter();
  const theme = useTheme();
  const { refreshReturningSession } = useDeviceContactScanSession();
  const [changeSet, setChangeSet] = useState(initialChangeSet);
  const [plan, setPlan] = useState<ContactWritePlan | null>(initialPlan ?? null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const executionInFlight = useRef(false);
  const automaticPreparationStarted = useRef(false);
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
  const counts = useMemo(() => summarizeChangeDecisions(changeSet), [changeSet]);
  const reviewedCount = counts.accepted + counts.rejected + counts.skipped;
  const totalCount = reviewedCount + counts.pending;
  const pendingChanges = useMemo(
    () => changeSet.changes.filter(({ decision }) => decision === 'pending'),
    [changeSet],
  );
  const currentChange = pendingChanges[0];
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
  const listChanges = currentChange ? [currentChange] : [];

  const decide = async (changeId: string, decision: ReviewDecision) => {
    const next = setChangeDecision(changeSet, changeId, decision);
    setIsSaving(true);
    setSaveError(false);
    setPlan(null);
    setPrepareError(null);
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

  const resolveCustomName = async (changeId: string, displayName: string) => {
    const next = resolveMergeConflictWithCustomName({ changeSet, changeId, displayName });
    setIsSaving(true);
    setSaveError(false);
    setPlan(null);
    try {
      await onReview(next);
      setChangeSet(next);
    } catch (error) {
      setSaveError(true);
      throw error;
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

  const proposeDeletion = async (changeId: string, contactId: string) => {
    const next = proposeContactDeletion({ changeSet, changeId, contactId });
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

  const proposeGroupDeletion = async (changeId: string) => {
    const next = proposeMergeGroupDeletion({ changeSet, changeId });
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

  const prepare = async (): Promise<ContactWritePlan | null> => {
    setIsPreparing(true);
    setPrepareError(null);
    try {
      const prepared = await onPrepare(changeSet);
      setPlan(prepared);
      return prepared;
    } catch (error) {
      setPlan(null);
      setPrepareError(error instanceof Error ? error.message : 'The safety check failed unexpectedly.');
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

  useEffect(() => {
    if (!autoPrepareSingleOwnedFixture || automaticPreparationStarted.current || initialPlan) return;
    // Preparation is read-only. The independent simulator writer still requires both fixture
    // ownership markers before it can execute this plan.
    const target = changeSet.changes.find((change) => change.kind !== 'merge');
    if (!target) return;
    automaticPreparationStarted.current = true;
    let next = changeSet;
    for (const change of changeSet.changes) {
      next = setChangeDecision(next, change.id, change.id === target.id ? 'accepted' : 'skipped');
    }
    void Promise.resolve().then(async () => {
      setIsSaving(true);
      try {
        await onReview(next);
        const prepared = await onPrepare(next);
        setChangeSet(next);
        setPlan(prepared);
      } catch (error) {
        setPrepareError(error instanceof Error ? error.message : 'The safety check failed unexpectedly.');
      } finally {
        setIsSaving(false);
      }
    });
  }, [autoPrepareSingleOwnedFixture, changeSet, initialPlan, onPrepare, onReview]);

  const finish = async () => {
    await refreshReturningSession();
    router.replace('/');
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
        if (changed) await refreshReturningSession();
      } catch {
        setViewContactError(true);
      } finally {
        setIsViewingContact(false);
      }
    };
    return (
      <ThemedView style={styles.completionScreen}>
        <SafeAreaView style={styles.completionSafeArea}>
          <ScrollView contentContainerStyle={styles.completionContent}>
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
              Everything was checked after saving. You can safely undo a completed change from History.
            </ThemedText>
            {successful && (
              <ThemedView type="backgroundElement" style={styles.completionEducationCard}>
                <ThemedText type="smallBold">You stay in control</ThemedText>
                <View style={styles.educationRow}>
                  <ThemedText style={[styles.educationMark, { color: theme.success }]}>✓</ThemedText>
                  <ThemedText type="small">Only the changes you approved were applied.</ThemedText>
                </View>
                <View style={styles.educationRow}>
                  <ThemedText style={[styles.educationMark, { color: theme.success }]}>✓</ThemedText>
                  <ThemedText type="small">Each result was read back and verified.</ThemedText>
                </View>
                <View style={styles.educationRow}>
                  <ThemedText style={[styles.educationMark, { color: theme.success }]}>✓</ThemedText>
                  <ThemedText type="small">History keeps your restore points and Undo actions.</ThemedText>
                </View>
              </ThemedView>
            )}
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
                    {undoableTransactions.length - 1} earlier {undoableTransactions.length === 2 ? 'change is' : 'changes are'} available in History.
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
              <ThemedText type="smallBold" style={{ color: theme.primary }}>View History</ThemedText>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => void finish()} style={[styles.applyButton, { backgroundColor: theme.primary }]}>
              <ThemedText style={styles.applyText}>Done</ThemedText>
            </Pressable>
          </ScrollView>
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
          <ThemedText type="title" style={styles.title}>
            {currentChange?.kind === 'merge' ? 'Review possible duplicate' : 'Review suggestion'}
          </ThemedText>
          <ThemedText themeColor="textSecondary">
            {counts.pending > 0
              ? `${reviewedCount + 1} of ${totalCount}. Choose the one action that feels right.`
              : 'You’re done reviewing. Check the summary, then apply your approved changes.'}
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
            <ThemedText type="smallBold">{counts.accepted} approved</ThemedText>
            <ThemedText type="smallBold">{counts.rejected} ignored</ThemedText>
            <ThemedText type="smallBold">{counts.skipped} for later</ThemedText>
            <ThemedText type="smallBold" style={{ color: theme.primary }}>{counts.pending} left</ThemedText>
          </ThemedView>
        </View>
      }
      ListEmptyComponent={counts.pending === 0 ? (
        <ThemedView type="backgroundElement" style={styles.emptyCard}>
          <ThemedText type="smallBold">Review complete</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {counts.accepted > 0
              ? `${counts.accepted} approved ${counts.accepted === 1 ? 'change is' : 'changes are'} ready for the final safety check.`
              : 'Nothing was approved. Your contacts will stay exactly as they are.'}
          </ThemedText>
          {counts.accepted === 0 && (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace('/')}
              style={[styles.mergePrimaryButton, { backgroundColor: theme.primary }]}>
              <ThemedText style={styles.selectedDecisionText}>Done</ThemedText>
            </Pressable>
          )}
        </ThemedView>
      ) : null}
      renderItem={({ item }) => (
        <ChangeCard
          change={item}
          onResolveConflict={(field, sourceContactId) => {
            if (!isSaving) void resolveConflict(item.id, field, sourceContactId);
          }}
          onResolveCustomName={(displayName) => resolveCustomName(item.id, displayName)}
          onProposeDeletion={(contactId) => {
            if (!isSaving) void proposeDeletion(item.id, contactId);
          }}
          onProposeGroupDeletion={() => {
            if (!isSaving) void proposeGroupDeletion(item.id);
          }}
          onDecorate={(decoration) => decorate(item.id, decoration)}
          onDecision={(decision) => {
            if (!isSaving) {
              void decide(item.id, decision);
            }
          }}
        />
      )}
      ListFooterComponent={
        counts.pending === 0 && counts.accepted > 0 ? (
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
                  {prepareError}
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
              No contact changes until you approve the final confirmation.
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
  const { certify, prepare: prepareToken } = useLocalSearchParams<{
    certify?: string | string[];
    prepare?: string | string[];
  }>();
  const theme = useTheme();
  const { state, invalidateScan } = useDeviceContactScanSession();
  const generatedChangeSet = useMemo(
    () =>
      state.status === 'success'
        ? createBeautificationChangeSet({
            snapshot: state.snapshot,
            duplicateAnalysis: state.analysis,
            matchAnalysis: state.matchAnalysis,
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
          const matchesActiveScan = saved && isWorkflowCompatibleWithActiveScan(saved,
            state.status === 'success'
              ? { status: 'success', mode: state.mode, snapshotId: state.snapshot.id }
              : { status: state.status });
          if (saved && saved.changeSet.changes.length > 0 && matchesActiveScan) {
            if (active) setWorkflow(saved);
            return;
          }
        }
        if (
          state.status === 'success' && state.mode === 'device' && generatedChangeSet
          && generatedChangeSet.changes.length > 0
        ) {
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
    if (workflow) {
      const latest = await manageCleanupWorkflow.load(workflow.id);
      if (!latest) throw new Error('Saved review is unavailable.');
      setWorkflow(await manageCleanupWorkflow.preflight(latest, plan));
    }
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
    return result;
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
  const autoPrepareSingleOwnedFixture =
    __DEV__ && Platform.OS === 'ios' && !Device.isDevice &&
    state.status === 'success' && state.mode === 'device' &&
    workflow?.snapshotId === state.snapshot.id &&
    Constants.appOwnership !== AppOwnership.Expo &&
    [certify, prepareToken].some((value) =>
      (Array.isArray(value) ? value[0] : value) === IOS_SIMULATOR_PREPARE_SINGLE_WRITE_TOKEN);
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
            key={`${changeSet.id}:${workflow?.id ?? 'generated'}`}
            initialChangeSet={changeSet}
            initialPlan={workflow?.writePlan}
            isDemo={state.status === 'success' && state.mode === 'demo'}
            onPrepare={prepare}
            onReview={saveReview}
            onExecute={simulatorExecutionEnabled ? execute : undefined}
            verifiedBackupId={state.status === 'success' ? state.backup.id : undefined}
            autoPrepareSingleOwnedFixture={autoPrepareSingleOwnedFixture}
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
    flexGrow: 1,
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
  completionEducationCard: { width: '100%', padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  educationRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  educationMark: { fontSize: 18, lineHeight: 22, fontWeight: '800' },
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
  mergeCard: { width: '100%', minWidth: 0, gap: Spacing.four, paddingVertical: Spacing.two },
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
  previewMode: { flex: 1, minWidth: 0, minHeight: 40, paddingHorizontal: Spacing.half, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  sectionHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  sectionHeading: { flex: 1, flexShrink: 1 },
  nativeGroup: { borderRadius: Spacing.three, paddingHorizontal: Spacing.three, overflow: 'hidden' },
  duplicateGroup: { borderRadius: Spacing.three, paddingHorizontal: Spacing.three, overflow: 'hidden' },
  duplicateRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  bulkActions: { gap: Spacing.one, paddingTop: Spacing.two },
  sourceRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  sourceDetail: { minHeight: 68, paddingVertical: Spacing.three },
  sourceValue: { gap: Spacing.half, paddingTop: Spacing.two },
  deleteInsteadButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  deleteGroupButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.one },
  deleteSafetyNote: { lineHeight: 19 },
  sourceCopy: { flex: 1, minWidth: 0, gap: Spacing.half },
  chevron: { color: '#AEAEB2', fontSize: 32, lineHeight: 34, fontWeight: '300' },
  nativeDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#C7C7CC' },
  mergedValueRow: { minHeight: 66, justifyContent: 'center', gap: Spacing.half, paddingVertical: Spacing.two },
  changeValueRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  conflictSection: { gap: Spacing.two, paddingTop: Spacing.two },
  conflictOption: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  nameEditorSection: { gap: Spacing.two },
  customNameSection: { gap: Spacing.two, padding: Spacing.three, borderRadius: Spacing.three },
  selectedCustomNameRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: Spacing.three },
  nameEditorActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  inlineRenameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  inlineNameEditor: { gap: Spacing.two },
  decorationSection: { gap: Spacing.two, paddingTop: Spacing.two },
  decorationKinds: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  decorationKind: { borderWidth: 1, borderRadius: 16, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
  decorationInput: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.three, fontSize: 16 },
  decorationActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  decorationApply: { minHeight: 44, borderRadius: 12, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  mergeActions: { gap: Spacing.one, paddingTop: Spacing.one },
  finalPreviewSection: { gap: Spacing.two },
  finalPreviewHeading: { gap: Spacing.half },
  finalPreviewCard: { padding: Spacing.three, borderRadius: Spacing.three },
  mergePrimaryButton: { minHeight: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  mergeTextButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  notDuplicatesButton: { minHeight: 60, alignItems: 'center', justifyContent: 'center', gap: Spacing.half, paddingHorizontal: Spacing.two },
  notDuplicatesNote: { textAlign: 'center' },
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
