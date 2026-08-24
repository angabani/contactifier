import { createIosCertificationReport } from '@/features/developer/ios-certification-report';

describe('iOS certification report', () => {
  it('never certifies missing durable evidence', () => {
    const report = createIosCertificationReport({
      generatedAt: '2026-08-23T00:00:00.000Z',
      verifiedBackupSelected: true,
      fixtureSetReady: true,
      workflows: [],
    });
    expect(report.certified).toBe(false);
    expect(report.items.every(({ status }) => status === 'pending')).toBe(true);
  });
});
