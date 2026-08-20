import {
  isCurrentPhotoLease,
  photoLeaseName,
} from '@/infrastructure/backups/expo';

describe('photo lease retention', () => {
  it('preserves only leases owned by the current process session', () => {
    const current = photoLeaseName('session-current', 'backup-1', 'lease-1');
    const previous = photoLeaseName('session-previous', 'backup-1', 'lease-1');

    expect(isCurrentPhotoLease(current, 'session-current')).toBe(true);
    expect(isCurrentPhotoLease(previous, 'session-current')).toBe(false);
    expect(isCurrentPhotoLease('backup-legacy-lease', 'session-current')).toBe(false);
  });

  it('names leases without relying on filesystem paths or user data', () => {
    expect(photoLeaseName('session', 'backup', 'lease')).toBe(
      'lease-session--backup--lease',
    );
  });
});
