export type ContactConfirmationType = 'merge' | 'update' | 'delete' | 'restore' | 'undo';

export type ContactConfirmationPreferences = Readonly<Record<ContactConfirmationType, boolean>>;

export const defaultContactConfirmationPreferences: ContactConfirmationPreferences = Object.freeze({
  merge: true,
  update: true,
  delete: true,
  restore: true,
  undo: true,
});

export interface ContactConfirmationPreferenceRepository {
  load(): Promise<ContactConfirmationPreferences>;
  save(value: ContactConfirmationPreferences): Promise<void>;
  reset(): Promise<void>;
}
