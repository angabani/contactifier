import type { CanonicalContact } from '@/domain';

export interface ContactReviewValue {
  readonly id: string;
  readonly kind: 'email' | 'phone';
  readonly label: string;
  readonly value: string;
}

export function contactReviewValues(contact: CanonicalContact): readonly ContactReviewValue[] {
  return Object.freeze([
    ...contact.phoneNumbers.map((item) => ({
      id: `phone:${item.id}`,
      kind: 'phone' as const,
      label: item.label?.trim() || 'Phone',
      value: item.value.raw,
    })),
    ...contact.emailAddresses.map((item) => ({
      id: `email:${item.id}`,
      kind: 'email' as const,
      label: item.label?.trim() || 'Email',
      value: item.value,
    })),
  ]);
}
