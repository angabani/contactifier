import {
  createChangeSet,
  createConfidenceScore,
  type ChangeSet,
} from '@/domain';

export function proposeContactDeletion(input: {
  readonly changeSet: ChangeSet;
  readonly changeId: string;
  readonly contactId: string;
}): ChangeSet {
  const target = input.changeSet.changes.find(({ id }) => id === input.changeId);
  if (!target) throw new Error('Cannot change an unknown review suggestion.');
  const contacts = target.kind === 'merge' ? target.before : [target.before];
  const contact = contacts.find(({ id }) => id === input.contactId);
  if (!contact) throw new Error('The selected contact is not part of this review.');

  return createChangeSet({
    ...input.changeSet,
    changes: input.changeSet.changes.map((change) => change.id === target.id ? {
      id: target.id,
      kind: 'delete' as const,
      origin: 'user' as const,
      confidence: createConfidenceScore(1),
      reasons: ['Marked as unwanted during review'],
      decision: 'pending' as const,
      contactId: contact.id,
      before: contact,
    } : change),
  });
}
