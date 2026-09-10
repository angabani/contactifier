export const IOS_CERTIFICATION_CONFIRMATION = 'CONTACTIFIER DISPOSABLE CONTACTS ONLY';
export const IOS_SIMULATOR_SEED_TOKEN = 'contactifier-dataset-v2';
export const IOS_SIMULATOR_READ_ONLY_SCAN_TOKEN = 'contactifier-read-only-scan-v1';
export const IOS_SIMULATOR_LOCAL_MODEL_TOKEN = 'contactifier-local-model-v1';
export const IOS_SIMULATOR_DISCARD_REVIEW_TOKEN = 'contactifier-discard-review-v1';
export const IOS_SIMULATOR_PREPARE_SINGLE_WRITE_TOKEN = 'contactifier-prepare-owned-single-write-v1';
export const IOS_SIMULATOR_RESET_FIXTURES_TOKEN = 'contactifier-reset-owned-fixtures-v1';
export const IOS_SIMULATOR_RESUME_REVIEW_TOKEN = 'contactifier-resume-review-v1';
export const IOS_SIMULATOR_ROLLBACK_TRIAL_TOKEN = 'contactifier-run-owned-rollback-v1';
export const IOS_SIMULATOR_LOST_WRITE_RESPONSE_TRIAL_TOKEN = 'contactifier-run-owned-lost-write-response-v1';
export const IOS_SIMULATOR_LATEST_BACKUP_ALIAS = 'latest';
export const IOS_SIMULATOR_PERMISSION_DENIAL_TRIAL_TOKEN = 'contactifier-run-permission-denial-v1';
export const IOS_SIMULATOR_COMPLETION_SUITE_TOKEN = 'contactifier-run-completion-suite-v1';
export const IOS_SIMULATOR_REPORT_TOKEN = 'contactifier-generate-report-v1';

export type IosCertificationDenialReason =
  | 'development-build-required'
  | 'expo-go-unsupported'
  | 'full-access-required'
  | 'ios-required';

export type IosCertificationTarget = 'physical-device' | 'simulator';

export interface IosCertificationEnvironment {
  readonly development: boolean;
  readonly platform: string;
  readonly physicalDevice: boolean;
  readonly expoGo: boolean;
  readonly fullContactAccess: boolean;
}

export interface IosCertificationScenario {
  readonly id: string;
  readonly title: string;
  readonly expectedEvidence: string;
}

export function iosCertificationTarget(
  environment: Pick<IosCertificationEnvironment, 'physicalDevice'>,
): IosCertificationTarget {
  return environment.physicalDevice ? 'physical-device' : 'simulator';
}

export const IOS_CERTIFICATION_SCENARIOS: readonly IosCertificationScenario[] = Object.freeze([
  { id: 'backup-restore', title: 'Encrypted backup and restore', expectedEvidence: 'Original fields and photo bytes round-trip exactly.' },
  { id: 'merge', title: 'Merge two disposable contacts', expectedEvidence: 'One verified survivor remains and both sources can be restored.' },
  { id: 'write-interruption', title: 'Interrupt each native write', expectedEvidence: 'Restart reconciles without retrying an ambiguous mutation.' },
  { id: 'finalization-interruption', title: 'Interrupt marker finalization', expectedEvidence: 'A fresh authorization resumes idempotent marker removal.' },
  { id: 'rollback', title: 'Force verification failure', expectedEvidence: 'Reverse-order compensation restores the exact before-state.' },
  { id: 'user-undo', title: 'Undo a completed transaction', expectedEvidence: 'A separate inverse transaction restores and verifies the original native records.' },
  { id: 'permission-change', title: 'Revoke or limit contact access', expectedEvidence: 'Execution stops before mutation and reports the prerequisite.' },
  { id: 'rich-field-round-trip', title: 'Preserve rich contact fields', expectedEvidence: 'Addresses, organizations, URLs, dates, groups, and structured names survive verified mutation and restoration.' },
  { id: 'photo-round-trip', title: 'Create and recreate with a photo', expectedEvidence: 'Pending explicit SHA-256 comparison between authenticated backup bytes and the native iOS photo after verified restoration.' },
]);

export function iosCertificationDenialReasons(
  environment: IosCertificationEnvironment,
): readonly IosCertificationDenialReason[] {
  const reasons: IosCertificationDenialReason[] = [];
  if (!environment.development) reasons.push('development-build-required');
  if (environment.platform !== 'ios') reasons.push('ios-required');
  if (environment.expoGo) reasons.push('expo-go-unsupported');
  if (!environment.fullContactAccess) reasons.push('full-access-required');
  return Object.freeze(reasons);
}

export function canArmIosCertificationHarness(input: {
  readonly environment: IosCertificationEnvironment;
  readonly confirmation: string;
  readonly selectedBackupId: string;
  readonly verifiedBackupIds: readonly string[];
}): boolean {
  return (
    iosCertificationDenialReasons(input.environment).length === 0 &&
    input.confirmation === IOS_CERTIFICATION_CONFIRMATION &&
    input.selectedBackupId.trim().length > 0 &&
    input.verifiedBackupIds.includes(input.selectedBackupId)
  );
}

export function canManageIosCertificationFixtures(input: {
  readonly environment: IosCertificationEnvironment;
  readonly confirmation: string;
}): boolean {
  return (
    iosCertificationDenialReasons(input.environment).length === 0 &&
    input.confirmation === IOS_CERTIFICATION_CONFIRMATION
  );
}

export function canAutoSeedIosSimulator(input: {
  readonly environment: IosCertificationEnvironment;
  readonly seedToken: string | undefined;
}): boolean {
  return (
    iosCertificationTarget(input.environment) === 'simulator' &&
    iosCertificationDenialReasons(input.environment).length === 0 &&
    input.seedToken === IOS_SIMULATOR_SEED_TOKEN
  );
}
