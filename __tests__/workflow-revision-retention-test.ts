import {
  DEFAULT_RETAINED_WORKFLOW_REVISIONS,
  selectWorkflowRevisionDirectoriesToPrune,
  workflowRevisionFromDirectoryName,
} from '@/infrastructure/workflows/workflow-revision-retention';

describe('workflow revision retention', () => {
  it('keeps the newest two committed revisions by default', () => {
    expect(
      selectWorkflowRevisionDirectoriesToPrune([
        'r-0000000001',
        'r-0000000003',
        'r-0000000000',
        'r-0000000002',
      ]),
    ).toEqual(['r-0000000001', 'r-0000000000']);
    expect(DEFAULT_RETAINED_WORKFLOW_REVISIONS).toBe(2);
  });

  it('never treats temporary, malformed, or unrelated directories as committed history', () => {
    expect(
      selectWorkflowRevisionDirectoriesToPrune([
        '.tmp-3-id',
        'r-0000000001',
        'r-2',
        'notes',
      ]),
    ).toEqual([]);
    expect(workflowRevisionFromDirectoryName('../r-0000000001')).toBeNull();
  });

  it('requires at least one recovery revision', () => {
    expect(() => selectWorkflowRevisionDirectoriesToPrune(['r-0000000001'], 0)).toThrow(
      'At least one',
    );
  });
});
