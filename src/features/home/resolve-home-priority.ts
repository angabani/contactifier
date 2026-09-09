export type HomePriority =
  | 'resolve-restore-conflict'
  | 'recover-interrupted-change'
  | 'approve-prepared-change'
  | 'continue-saved-review'
  | 'review-suggestions'
  | 'scan-contacts'
  | 'everything-looks-good';

export interface HomePriorityState {
  readonly hasRestoreConflict: boolean;
  readonly hasInterruptedChange: boolean;
  readonly hasPreparedApproval: boolean;
  readonly hasSavedReview: boolean;
  readonly suggestionCount: number;
  readonly hasVerifiedBaseline: boolean;
}

/**
 * Selects one and only one user-facing task for Home.
 *
 * Keep this policy independent from UI and persistence so every entry point applies the same
 * ordering as more workflow states become available.
 */
export function resolveHomePriority(state: HomePriorityState): HomePriority {
  if (state.hasRestoreConflict) return 'resolve-restore-conflict';
  if (state.hasInterruptedChange) return 'recover-interrupted-change';
  if (state.hasPreparedApproval) return 'approve-prepared-change';
  if (state.hasSavedReview) return 'continue-saved-review';
  if (state.suggestionCount > 0) return 'review-suggestions';
  if (!state.hasVerifiedBaseline) return 'scan-contacts';
  return 'everything-looks-good';
}
