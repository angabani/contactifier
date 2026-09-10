import type { CleanupWorkflow } from '@/domain';

export type ActiveContactScan =
  | { readonly status: 'success'; readonly mode: 'device'; readonly snapshotId: string }
  | { readonly status: Exclude<string, 'success'>; readonly mode?: never; readonly snapshotId?: never }
  | { readonly status: 'success'; readonly mode: Exclude<string, 'device'>; readonly snapshotId?: string };

/**
 * A device review must never reuse decisions or a preflight prepared for a
 * different native contact snapshot. Non-device screens may still inspect a
 * resumable workflow because they cannot execute it against the address book.
 */
export function isWorkflowCompatibleWithActiveScan(
  workflow: CleanupWorkflow,
  scan: ActiveContactScan,
): boolean {
  return scan.status !== 'success'
    || scan.mode !== 'device'
    || workflow.snapshotId === scan.snapshotId;
}
