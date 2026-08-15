export type ContactSourceKind = 'device' | 'google';

export interface ContactSourceRef {
  readonly kind: ContactSourceKind;
  readonly accountId?: string;
  readonly containerId?: string;
}

export interface ContactRecordRef {
  readonly source: ContactSourceRef;
  readonly sourceContactId: string;
  readonly revision?: string;
  readonly etag?: string;
}

export function isSameContactSource(
  left: ContactSourceRef,
  right: ContactSourceRef,
): boolean {
  return (
    left.kind === right.kind &&
    left.accountId === right.accountId &&
    left.containerId === right.containerId
  );
}
