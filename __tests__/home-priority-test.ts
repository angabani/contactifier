import { resolveHomePriority, type HomePriorityState } from '@/features/home/resolve-home-priority';

const healthy: HomePriorityState = {
  hasRestoreConflict: false,
  hasInterruptedChange: false,
  hasPreparedApproval: false,
  hasSavedReview: false,
  suggestionCount: 0,
  hasVerifiedBaseline: true,
};

describe('Home priority', () => {
  it('asks for the baseline scan only when no verified baseline exists', () => {
    expect(resolveHomePriority({ ...healthy, hasVerifiedBaseline: false })).toBe('scan-contacts');
    expect(resolveHomePriority(healthy)).toBe('everything-looks-good');
  });

  it('shows suggestions ahead of the healthy state', () => {
    expect(resolveHomePriority({ ...healthy, suggestionCount: 3 })).toBe('review-suggestions');
  });

  it('continues a saved review ahead of new suggestions or the healthy state', () => {
    expect(resolveHomePriority({ ...healthy, hasSavedReview: true, suggestionCount: 3 }))
      .toBe('continue-saved-review');
  });

  it('uses the safety-first ordering when several actions exist', () => {
    expect(resolveHomePriority({
      ...healthy,
      hasRestoreConflict: true,
      hasInterruptedChange: true,
      hasPreparedApproval: true,
      hasSavedReview: true,
      suggestionCount: 2,
    })).toBe('resolve-restore-conflict');
    expect(resolveHomePriority({
      ...healthy,
      hasInterruptedChange: true,
      hasPreparedApproval: true,
      hasSavedReview: true,
      suggestionCount: 2,
    })).toBe('recover-interrupted-change');
    expect(resolveHomePriority({
      ...healthy,
      hasPreparedApproval: true,
      hasSavedReview: true,
      suggestionCount: 2,
    })).toBe('approve-prepared-change');
  });
});
