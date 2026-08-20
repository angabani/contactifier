import {
  contactsSemanticallyEqual,
  isSameContactSource,
  type CanonicalContact,
  type CleanupWorkflow,
  type ContactSnapshot,
  type ProposedChange,
} from '@/domain';

import { isPerChangeCleanupWorkflow } from './create-per-change-cleanup-workflows';

export type ContactTransactionUndoBlockReason =
  | 'after-state-changed'
  | 'dependency'
  | 'not-completed'
  | 'not-independent'
  | 'source-mismatch';

export interface ContactTransactionUndoPreview {
  readonly transactionId: string;
  readonly ready: boolean;
  readonly blockReasons: readonly ContactTransactionUndoBlockReason[];
  readonly conflictingSourceContactIds: readonly string[];
  readonly dependentWorkflowIds: readonly string[];
  readonly contactsToRestore: readonly CanonicalContact[];
  readonly compensationCount: number;
}

function beforeContacts(change: ProposedChange): readonly CanonicalContact[] {
  return change.kind === 'merge' ? change.before : [change.before];
}

function affectedSourceIds(workflow: CleanupWorkflow): Set<string> {
  const ids = new Set(
    workflow.changeSet.changes.flatMap((change) =>
      beforeContacts(change).map(({ recordRef }) => recordRef.sourceContactId),
    ),
  );
  workflow.journal.forEach(({ outcome, receipt }) => {
    if (outcome === 'applied' && receipt) ids.add(receipt.sourceContactId);
  });
  return ids;
}

function expectedPresentContact(
  workflow: CleanupWorkflow,
  change: ProposedChange,
): { readonly sourceContactId: string; readonly contact: CanonicalContact } | null {
  if (change.kind === 'delete') return null;
  const create = workflow.writePlan?.operations.find(
    (operation) => operation.changeId === change.id && operation.kind === 'create',
  );
  if (!create) return { sourceContactId: change.after.recordRef.sourceContactId, contact: change.after };
  const receipt = workflow.journal.find(
    ({ operationId, outcome, receipt: item }) =>
      operationId === create.id && outcome === 'applied' && Boolean(item),
  )?.receipt;
  return receipt
    ? { sourceContactId: receipt.sourceContactId, contact: change.after }
    : null;
}

export function previewContactTransactionUndo(input: {
  readonly workflow: CleanupWorkflow;
  readonly currentSnapshot: ContactSnapshot;
  readonly laterWorkflows: readonly CleanupWorkflow[];
}): ContactTransactionUndoPreview {
  const { workflow, currentSnapshot, laterWorkflows } = input;
  const reasons = new Set<ContactTransactionUndoBlockReason>();
  const conflicts = new Set<string>();
  if (workflow.phase !== 'completed') reasons.add('not-completed');
  if (!isPerChangeCleanupWorkflow(workflow)) {
    reasons.add('not-independent');
  }
  if (!isSameContactSource(workflow.source, currentSnapshot.source)) reasons.add('source-mismatch');
  const change = workflow.changeSet.changes[0];
  const currentBySourceId = new Map(
    currentSnapshot.contacts.map((contact) => [contact.recordRef.sourceContactId, contact]),
  );

  if (change && !reasons.has('source-mismatch')) {
    const expected = expectedPresentContact(workflow, change);
    if (expected) {
      const current = currentBySourceId.get(expected.sourceContactId);
      if (!current || !contactsSemanticallyEqual(current, expected.contact)) {
        reasons.add('after-state-changed');
        conflicts.add(expected.sourceContactId);
      }
    }
    const expectedPresentId = expected?.sourceContactId;
    for (const before of beforeContacts(change)) {
      const sourceId = before.recordRef.sourceContactId;
      if (sourceId !== expectedPresentId && currentBySourceId.has(sourceId)) {
        reasons.add('after-state-changed');
        conflicts.add(sourceId);
      }
    }
  }

  const affected = affectedSourceIds(workflow);
  const dependentWorkflowIds = laterWorkflows
    .filter((candidate) =>
      candidate.id !== workflow.id &&
      candidate.updatedAt > workflow.updatedAt &&
      [...affectedSourceIds(candidate)].some((sourceId) => affected.has(sourceId)),
    )
    .map(({ id }) => id);
  if (dependentWorkflowIds.length > 0) reasons.add('dependency');

  return Object.freeze({
    transactionId: workflow.id,
    ready: reasons.size === 0,
    blockReasons: Object.freeze([...reasons]),
    conflictingSourceContactIds: Object.freeze([...conflicts]),
    dependentWorkflowIds: Object.freeze(dependentWorkflowIds),
    contactsToRestore: Object.freeze(change ? [...beforeContacts(change)] : []),
    compensationCount: workflow.writePlan?.compensations.length ?? 0,
  });
}
