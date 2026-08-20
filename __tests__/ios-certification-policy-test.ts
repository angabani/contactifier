import {
  canArmIosCertificationHarness,
  IOS_CERTIFICATION_CONFIRMATION,
  IOS_CERTIFICATION_SCENARIOS,
  iosCertificationDenialReasons,
} from '@/features/developer/ios-certification-policy';

const eligible = {
  development: true,
  platform: 'ios',
  physicalDevice: true,
  expoGo: false,
  fullContactAccess: true,
};

describe('iOS certification harness policy', () => {
  it('requires every environment boundary even through a direct route', () => {
    expect(iosCertificationDenialReasons({
      development: false,
      platform: 'android',
      physicalDevice: false,
      expoGo: true,
      fullContactAccess: false,
    })).toEqual([
      'development-build-required',
      'ios-required',
      'physical-device-required',
      'expo-go-unsupported',
      'full-access-required',
    ]);
  });

  it('requires an exact destructive-test phrase and verified backup identity', () => {
    expect(canArmIosCertificationHarness({
      environment: eligible,
      confirmation: IOS_CERTIFICATION_CONFIRMATION,
      selectedBackupId: 'backup-verified',
      verifiedBackupIds: ['backup-verified'],
    })).toBe(true);
    expect(canArmIosCertificationHarness({
      environment: eligible,
      confirmation: 'yes',
      selectedBackupId: 'backup-verified',
      verifiedBackupIds: ['backup-verified'],
    })).toBe(false);
    expect(canArmIosCertificationHarness({
      environment: eligible,
      confirmation: IOS_CERTIFICATION_CONFIRMATION,
      selectedBackupId: 'backup-fabricated',
      verifiedBackupIds: ['backup-verified'],
    })).toBe(false);
  });

  it('defines unique evidence scenarios without changing certification flags', () => {
    expect(new Set(IOS_CERTIFICATION_SCENARIOS.map(({ id }) => id)).size).toBe(
      IOS_CERTIFICATION_SCENARIOS.length,
    );
    expect(IOS_CERTIFICATION_SCENARIOS).toHaveLength(7);
  });
});
