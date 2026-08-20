import {
  canArmIosCertificationHarness,
  canAutoSeedIosSimulator,
  canManageIosCertificationFixtures,
  IOS_CERTIFICATION_CONFIRMATION,
  IOS_CERTIFICATION_SCENARIOS,
  IOS_SIMULATOR_SEED_TOKEN,
  iosCertificationTarget,
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
      'expo-go-unsupported',
      'full-access-required',
    ]);
  });

  it('allows disposable fixture certification in an iOS simulator', () => {
    const simulator = { ...eligible, physicalDevice: false };

    expect(iosCertificationTarget(simulator)).toBe('simulator');
    expect(iosCertificationDenialReasons(simulator)).toEqual([]);
    expect(canManageIosCertificationFixtures({
      environment: simulator,
      confirmation: IOS_CERTIFICATION_CONFIRMATION,
    })).toBe(true);
  });

  it('still identifies a physical contact store separately', () => {
    expect(iosCertificationTarget(eligible)).toBe('physical-device');
    expect(canAutoSeedIosSimulator({
      environment: eligible,
      seedToken: IOS_SIMULATOR_SEED_TOKEN,
    })).toBe(false);
  });

  it('allows exact-token automated seeding only in an eligible simulator', () => {
    const simulator = { ...eligible, physicalDevice: false };
    expect(canAutoSeedIosSimulator({ environment: simulator, seedToken: IOS_SIMULATOR_SEED_TOKEN })).toBe(true);
    expect(canAutoSeedIosSimulator({ environment: simulator, seedToken: 'wrong' })).toBe(false);
    expect(canAutoSeedIosSimulator({ environment: { ...simulator, development: false }, seedToken: IOS_SIMULATOR_SEED_TOKEN })).toBe(false);
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
