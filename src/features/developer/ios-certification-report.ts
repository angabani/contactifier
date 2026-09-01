import type { CleanupWorkflow } from '@/domain';
import { IOS_CERTIFICATION_SCENARIOS } from './ios-certification-policy';
import { isSimulatorFixtureWritePlanOwned } from './simulator-fixture-write-policy';
import type { IosPermissionDenialEvidence } from './ios-certification-permission-evidence';
import type { IosPhotoRoundTripEvidence } from './ios-certification-photo-evidence';

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

function isRestorationWorkflow(workflow: CleanupWorkflow): boolean {
  return workflow.changeSet.id.includes(':restore:') || workflow.changeSet.id.includes(':undo:transaction:');
}

function operationContact(operation: NonNullable<CleanupWorkflow['writePlan']>['operations'][number]) {
  return operation.kind === 'create'
    ? operation.contact
    : operation.kind === 'update'
      ? operation.after
      : operation.before;
}

type RichFieldCategory = 'addresses' | 'dates' | 'groups' | 'organizations' | 'structured-names' | 'urls';

function richFieldCoverage(workflow: CleanupWorkflow): ReadonlySet<RichFieldCategory> {
  const coverage = new Set<RichFieldCategory>();
  for (const operation of workflow.writePlan?.operations ?? []) {
    const contact = operationContact(operation);
    if (contact.postalAddresses.length > 0) coverage.add('addresses');
    if (contact.organizations.length > 0) coverage.add('organizations');
    if (contact.urls.some(({ value }) => !value.startsWith('contactifier://'))) coverage.add('urls');
    if (contact.birthdays.length > 0 || contact.events.length > 0) coverage.add('dates');
    if (contact.groups.length > 0) coverage.add('groups');
    if (Boolean(
      contact.name?.prefix || contact.name?.middleName || contact.name?.suffix ||
      contact.name?.phoneticGivenName || contact.name?.phoneticMiddleName || contact.name?.phoneticFamilyName
    )) coverage.add('structured-names');
  }
  return coverage;
}

export function createIosCertificationReport(input: {
  readonly generatedAt: string;
  readonly selectedVerifiedBackupId?: string;
  readonly fixtureSetReady: boolean;
  readonly workflows: readonly CleanupWorkflow[];
  readonly permissionEvidence?: IosPermissionDenialEvidence | null;
  readonly photoEvidence?: IosPhotoRoundTripEvidence | null;
}): IosCertificationReport {
  const fixtureWorkflows = input.fixtureSetReady
    ? input.workflows.filter(({ writePlan }) => Boolean(writePlan && isSimulatorFixtureWritePlanOwned(writePlan)))
    : [];
  const completedFixtures = fixtureWorkflows.filter(({ phase }) => phase === 'completed');
  const passed = new Map<string, string>();
  const permissionWorkflow = input.permissionEvidence
    ? fixtureWorkflows.find(({ id }) => id === input.permissionEvidence?.workflowId)
    : undefined;
  if (
    input.permissionEvidence && permissionWorkflow &&
    input.permissionEvidence.backupId === input.selectedVerifiedBackupId &&
    permissionWorkflow.backupId === input.permissionEvidence.backupId &&
    permissionWorkflow.phase === 'preflighted' &&
    permissionWorkflow.revision === input.permissionEvidence.revisionAfter &&
    permissionWorkflow.journal.length === input.permissionEvidence.journalEntriesAfter
  ) {
    passed.set('permission-change', 'Full contact access was denied before writer invocation, and the owned workflow revision and journal remained unchanged.');
  }
  if (input.selectedVerifiedBackupId && completedFixtures.some(
    ({ backupId, changeSet }) => backupId === input.selectedVerifiedBackupId && changeSet.id.includes(':restore:'),
  )) {
    passed.set('backup-restore', 'The selected verified fixture backup has a matching completed restore transaction.');
  }
  if (completedFixtures.some(({ changeSet }) => changeSet.changes.some(({ kind, decision }) => kind === 'merge' && decision === 'accepted'))) {
    passed.set('merge', 'A journaled merge completed with native verification.');
  }
  if (fixtureWorkflows.some(({ phase, journal }) =>
    phase === 'rolled-back' && journal.some(({ origin, outcome }) =>
      origin === 'reconciliation' && (outcome === 'applied' || outcome === 'not-applied')))) {
    passed.set('write-interruption', 'An unknown native outcome was explicitly reconciled and the transaction ended safely rolled back.');
  }
  if (completedFixtures.some(({ journal }) => journal.some(
    ({ origin, outcome }) => origin === 'recovery' && outcome === 'finalized',
  ))) {
    passed.set('finalization-interruption', 'Interrupted marker finalization resumed through the recovery path and completed.');
  }
  if (fixtureWorkflows.some(({ phase, rollbackCause, journal }) =>
    phase === 'rolled-back' && rollbackCause === 'verification-failed' && journal.some(({ outcome }) => outcome === 'compensated'))) {
    passed.set('rollback', 'Post-write verification failed and reverse-order compensation completed.');
  }
  if (completedFixtures.some(({ changeSet }) => changeSet.id.includes(':undo:transaction:'))) {
    passed.set('user-undo', 'A separate journaled Undo transaction completed with native verification.');
  }
  const requiredRichFields: readonly RichFieldCategory[] = [
    'addresses', 'organizations', 'urls', 'dates', 'groups', 'structured-names',
  ];
  const richCoverage = new Set(
    completedFixtures
      .filter(isRestorationWorkflow)
      .flatMap((workflow) => [...richFieldCoverage(workflow)]),
  );
  if (requiredRichFields.every((field) => richCoverage.has(field))) {
    passed.set('rich-field-round-trip', 'Verified restoration evidence covers addresses, organizations, non-Contactifier URLs, dates, groups, and structured names.');
  }
  const photoWorkflow = input.photoEvidence
    ? completedFixtures.find(({ id }) => id === input.photoEvidence?.workflowId)
    : undefined;
  const photoOperation = input.photoEvidence && photoWorkflow?.writePlan?.operations.find(
    ({ id }) => id === input.photoEvidence?.operationId,
  );
  const photoReceipt = input.photoEvidence && photoWorkflow?.journal.find(({ operationId, outcome, receipt }) =>
    operationId === input.photoEvidence?.operationId && outcome === 'applied' && receipt)?.receipt;
  if (
    input.photoEvidence && photoWorkflow &&
    input.photoEvidence.backupId === input.selectedVerifiedBackupId &&
    photoWorkflow.backupId === input.photoEvidence.backupId &&
    photoWorkflow.revision === input.photoEvidence.workflowRevision &&
    photoOperation?.kind === 'create' &&
    photoOperation.contact.photos.some((photo, index) =>
      (photo.assetId ?? `${photoOperation.contact.id}:${index}`) === input.photoEvidence?.assetId) &&
    photoReceipt?.sourceContactId === input.photoEvidence.nativeContactId &&
    input.photoEvidence.expectedSha256 === input.photoEvidence.actualSha256
  ) {
    passed.set('photo-round-trip', 'Native iOS photo bytes match the authenticated backup asset SHA-256 for the exact completed restoration receipt.');
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
