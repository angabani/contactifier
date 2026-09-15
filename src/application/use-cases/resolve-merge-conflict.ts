import { findMergeConflicts, type ChangeSet, type MergeConflictField } from '@/domain';

export function resolveMergeConflict(input: {
  readonly changeSet: ChangeSet;
  readonly changeId: string;
  readonly field: MergeConflictField;
  readonly sourceContactId: string;
}): ChangeSet {
  const target = input.changeSet.changes.find(({ id }) => id === input.changeId);
  if (!target || target.kind !== 'merge') throw new Error('Cannot resolve an unknown merge change.');
  const conflict = findMergeConflicts(target.before).find(({ field }) => field === input.field);
  if (!conflict) throw new Error(`Merge field ${input.field} is not conflicting.`);
  if (!conflict.options.some(({ sourceContactId }) => sourceContactId === input.sourceContactId)) {
    throw new Error('Conflict selection is not one of the reviewed source contacts.');
  }
  const source = target.before.find(({ id }) => id === input.sourceContactId);
  if (!source) throw new Error('Conflict source contact is unavailable.');
  const after = input.field === 'name'
    ? { ...target.after, displayName: source.displayName, name: source.name }
    : { ...target.after, organizations: source.organizations };
  const resolvedConflictFields = Object.freeze([
    ...new Set([...(target.resolvedConflictFields ?? []), input.field]),
  ]);
  return Object.freeze({
    ...input.changeSet,
    changes: Object.freeze(input.changeSet.changes.map((change) =>
      change.id === target.id ? Object.freeze({ ...target, after, resolvedConflictFields }) : change,
    )),
  });
}

export function resolveMergeConflictWithCustomName(input: {
  readonly changeSet: ChangeSet;
  readonly changeId: string;
  readonly displayName: string;
}): ChangeSet {
  const displayName = input.displayName.trim().replace(/\s+/g, ' ');
  if (!displayName) throw new Error('Enter a name for the merged contact.');
  const target = input.changeSet.changes.find(({ id }) => id === input.changeId);
  if (!target || target.kind !== 'merge') throw new Error('Cannot resolve an unknown merge change.');
  const hasNameConflict = findMergeConflicts(target.before).some(({ field }) => field === 'name');
  const resolvedConflictFields = hasNameConflict
    ? Object.freeze([...new Set([...(target.resolvedConflictFields ?? []), 'name' as const])])
    : target.resolvedConflictFields;
  const after = Object.freeze({
    ...target.after,
    displayName,
    name: Object.freeze({ givenName: displayName }),
  });
  return Object.freeze({
    ...input.changeSet,
    changes: Object.freeze(input.changeSet.changes.map((change) =>
      change.id === target.id ? Object.freeze({ ...target, after, resolvedConflictFields }) : change,
    )),
  });
}
