import type { ChangeSet, ContactDecoration } from '@/domain';

export class ContactDecorationConflictError extends Error {
  constructor(readonly field: 'company' | 'designation' | 'honorific') {
    super(`The proposed contact already has a different ${field}. Resolve it before decorating.`);
    this.name = 'ContactDecorationConflictError';
  }
}

export function decorateProposedContact(input: {
  readonly changeSet: ChangeSet;
  readonly changeId: string;
  readonly decoration?: ContactDecoration;
}): ChangeSet {
  const target = input.changeSet.changes.find(({ id }) => id === input.changeId);
  if (!target || target.kind === 'delete') throw new Error('Only contact results can be decorated.');
  let original = target.after;
  const previous = target.decoration;
  if (previous?.kind === 'honorific' && original.name?.prefix === previous.value.trim()) {
    original = { ...original, name: { ...original.name, prefix: undefined } };
  } else if (previous?.kind === 'visible-name-tag') {
    const prefix = `${previous.value.trim()} `;
    if (original.displayName.startsWith(prefix)) original = { ...original, displayName: original.displayName.slice(prefix.length) };
  } else if (previous?.kind === 'company' || previous?.kind === 'designation') {
    const field = previous.kind === 'company' ? 'name' : 'title';
    original = { ...original, organizations: original.organizations.filter((item) =>
      !(item.id === `${original.id}:decoration:organization` && item.value[field] === previous.value.trim())) };
  }
  let after = original;
  const decoration = input.decoration;
  if (decoration) {
    const value = decoration.value.trim();
    if (!value) throw new Error('Decoration value is required.');
    if (decoration.kind === 'honorific') {
      const existing = original.name?.prefix?.trim();
      if (existing && existing !== value) throw new ContactDecorationConflictError('honorific');
      after = { ...original, name: { ...original.name, prefix: value } };
    } else if (decoration.kind === 'visible-name-tag') {
      after = { ...original, displayName: `${value} ${original.displayName}`.trim() };
    } else {
      const field = decoration.kind === 'company' ? 'name' : 'title';
      const existing = original.organizations.find(({ value: organization }) => organization[field]?.trim());
      if (existing && existing.value[field]?.trim() !== value) {
        throw new ContactDecorationConflictError(decoration.kind);
      }
      const organizations = existing
        ? original.organizations.map((item) => item.id === existing.id
          ? { ...item, value: { ...item.value, [field]: value } } : item)
        : [...original.organizations, {
            id: `${original.id}:decoration:organization`,
            value: { [field]: value },
            origin: 'user' as const,
          }];
      after = { ...original, organizations };
    }
  }
  return Object.freeze({
    ...input.changeSet,
    changes: Object.freeze(input.changeSet.changes.map((change) => change.id === target.id
      ? Object.freeze({ ...target, after, decoration }) : change)),
  });
}
