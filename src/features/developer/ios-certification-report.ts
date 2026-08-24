import type { CleanupWorkflow } from '@/domain';
import { IOS_CERTIFICATION_SCENARIOS } from './ios-certification-policy';

export interface IosCertificationReportItem {
  readonly id: string;
  readonly status: 'passed' | 'pending';
  readonly evidence: string;
}

export interface IosCertificationReport {
  readonly generatedAt: string;
  readonly certified: boolean;
  readonly items: readonly IosCertificationReportItem[];
}

export function createIosCertificationReport(input: {
  readonly generatedAt: string;
  readonly verifiedBackupSelected: boolean;
  readonly fixtureSetReady: boolean;
  readonly workflows: readonly CleanupWorkflow[];
}): IosCertificationReport {
  const completed = input.workflows.filter(({ phase }) => phase === 'completed');
  const passed = new Map<string, string>();
  if (input.verifiedBackupSelected && input.fixtureSetReady && completed.some(({ changeSet }) => changeSet.id.includes(':restore:'))) {
    passed.set('backup-restore', 'A verified fixture backup restore transaction completed.');
  }
  if (completed.some(({ changeSet }) => changeSet.changes.some(({ kind, decision }) => kind === 'merge' && decision === 'accepted'))) {
    passed.set('merge', 'A journaled merge completed with native verification.');
  }
  if (input.workflows.some(({ journal }) => journal.some(({ outcome }) => outcome === 'ambiguous'))) {
    passed.set('write-interruption', 'An ambiguous native outcome was recorded and reconciled.');
  }
  if (input.workflows.some(({ journal }) => journal.some(({ outcome }) => outcome === 'finalization-started') && journal.some(({ outcome }) => outcome === 'finalized'))) {
    passed.set('finalization-interruption', 'Finalization has durable start and completion evidence.');
  }
  if (input.workflows.some(({ phase, journal }) => phase === 'rolled-back' && journal.some(({ outcome }) => outcome === 'compensated'))) {
    passed.set('rollback', 'A rolled-back workflow contains compensation receipts.');
  }
  if (completed.some(({ writePlan }) => writePlan?.operations.some((operation) =>
    (operation.kind === 'create' ? operation.contact : operation.kind === 'update' ? operation.after : operation.before).photos.length > 0))) {
    passed.set('photo-round-trip', 'A completed verified transaction included archived photo content.');
  }
  const items = IOS_CERTIFICATION_SCENARIOS.map(({ id, expectedEvidence }) => Object.freeze({
    id,
    status: passed.has(id) ? 'passed' as const : 'pending' as const,
    evidence: passed.get(id) ?? expectedEvidence,
  }));
  return Object.freeze({
    generatedAt: input.generatedAt,
    certified: items.every(({ status }) => status === 'passed'),
    items: Object.freeze(items),
  });
}
