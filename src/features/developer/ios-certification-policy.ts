export const IOS_CERTIFICATION_CONFIRMATION = 'CONTACTIFIER DISPOSABLE CONTACTS ONLY';

export type IosCertificationDenialReason =
  | 'development-build-required'
  | 'expo-go-unsupported'
  | 'full-access-required'
  | 'ios-required'
  | 'physical-device-required';

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

export const IOS_CERTIFICATION_SCENARIOS: readonly IosCertificationScenario[] = Object.freeze([
  { id: 'backup-restore', title: 'Encrypted backup and restore', expectedEvidence: 'Original fields and photo bytes round-trip exactly.' },
  { id: 'merge', title: 'Merge two disposable contacts', expectedEvidence: 'One verified survivor remains and both sources can be restored.' },
  { id: 'write-interruption', title: 'Interrupt each native write', expectedEvidence: 'Restart reconciles without retrying an ambiguous mutation.' },
  { id: 'finalization-interruption', title: 'Interrupt marker finalization', expectedEvidence: 'A fresh authorization resumes idempotent marker removal.' },
  { id: 'rollback', title: 'Force verification failure', expectedEvidence: 'Reverse-order compensation restores the exact before-state.' },
  { id: 'permission-change', title: 'Revoke or limit contact access', expectedEvidence: 'Execution stops before mutation and reports the prerequisite.' },
  { id: 'photo-round-trip', title: 'Create and recreate with a photo', expectedEvidence: 'Authenticated bytes produce the same visible contact photo.' },
]);

export function iosCertificationDenialReasons(
  environment: IosCertificationEnvironment,
): readonly IosCertificationDenialReason[] {
  const reasons: IosCertificationDenialReason[] = [];
  if (!environment.development) reasons.push('development-build-required');
  if (environment.platform !== 'ios') reasons.push('ios-required');
  if (!environment.physicalDevice) reasons.push('physical-device-required');
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
