export const DEFAULT_RETAINED_WORKFLOW_REVISIONS = 2;

const REVISION_DIRECTORY_PATTERN = /^r-(\d{10})$/;

export function workflowRevisionFromDirectoryName(name: string): number | null {
  const match = REVISION_DIRECTORY_PATTERN.exec(name);
  if (!match) return null;
  const revision = Number(match[1]);
  return Number.isSafeInteger(revision) ? revision : null;
}

export function selectWorkflowRevisionDirectoriesToPrune(
  names: readonly string[],
  retainedRevisionCount = DEFAULT_RETAINED_WORKFLOW_REVISIONS,
): readonly string[] {
  if (!Number.isSafeInteger(retainedRevisionCount) || retainedRevisionCount < 1) {
    throw new Error('At least one committed workflow revision must be retained.');
  }
  return names
    .map((name) => ({ name, revision: workflowRevisionFromDirectoryName(name) }))
    .filter((entry): entry is { name: string; revision: number } => entry.revision !== null)
    .sort((left, right) => right.revision - left.revision)
    .slice(retainedRevisionCount)
    .map(({ name }) => name);
}
