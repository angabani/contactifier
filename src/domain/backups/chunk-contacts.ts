import type { CanonicalContact } from '../contacts/contact';
import { assertDomain } from '../shared/invariant';

export function* chunkContacts(
  contacts: readonly CanonicalContact[],
  chunkContactLimit: number,
): Generator<readonly CanonicalContact[]> {
  assertDomain(
    Number.isInteger(chunkContactLimit) && chunkContactLimit > 0,
    'Backup chunk limit must be a positive integer.',
  );

  for (let offset = 0; offset < contacts.length; offset += chunkContactLimit) {
    yield contacts.slice(offset, offset + chunkContactLimit);
  }
}
