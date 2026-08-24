import type { ChangeSet } from '@/domain';
import type {
  ContactConfirmationPreferences,
  ContactConfirmationType,
} from '../ports/contact-confirmation-preference-repository';

export function acceptedConfirmationTypes(changeSet: ChangeSet): readonly ContactConfirmationType[] {
  return Object.freeze([
    ...new Set(
      changeSet.changes
        .filter(({ decision }) => decision === 'accepted')
        .map(({ kind }) => kind),
    ),
  ]);
}

export function requiresContactConfirmation(input: {
  readonly types: readonly ContactConfirmationType[];
  readonly preferences: ContactConfirmationPreferences;
  readonly sessionConfirmedTypes?: ReadonlySet<ContactConfirmationType>;
}): boolean {
  return input.types.some(
    (type) => input.preferences[type] && !input.sessionConfirmedTypes?.has(type),
  );
}
