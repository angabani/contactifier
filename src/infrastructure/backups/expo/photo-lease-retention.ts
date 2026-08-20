const PHOTO_LEASE_PREFIX = 'lease-';

export function photoLeaseName(sessionId: string, backupId: string, leaseId: string): string {
  return `${PHOTO_LEASE_PREFIX}${encodeURIComponent(sessionId)}--${encodeURIComponent(backupId)}--${encodeURIComponent(leaseId)}`;
}

export function isCurrentPhotoLease(name: string, sessionId: string): boolean {
  return name.startsWith(`${PHOTO_LEASE_PREFIX}${encodeURIComponent(sessionId)}--`);
}
