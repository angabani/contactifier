import type { CanonicalContact, ContactId } from '../contacts/contact';
import type { ContactSnapshot } from '../contacts/contact-snapshot';
import { normalizeEmailForExactMatch, normalizePhoneForExactMatch } from './exact-duplicate-analysis';

export type ContactMatchFeatureKind =
  | 'email'
  | 'emailLocalPart'
  | 'emailDomain'
  | 'phone'
  | 'phoneSuffix'
  | 'phoneCountry'
  | 'name'
  | 'givenName'
  | 'familyName'
  | 'nameOrder'
  | 'phoneticName'
  | 'nickname'
  | 'organization'
  | 'address'
  | 'sameSource';

export interface ContactMatchFeature {
  readonly kind: ContactMatchFeatureKind;
  readonly score: number | null;
  readonly explanation: string;
  readonly isConflict: boolean;
}

export interface ContactMatchMatrix {
  readonly schemaVersion: 1;
  readonly contactIds: readonly [ContactId, ContactId];
  readonly features: readonly ContactMatchFeature[];
}

export interface ContactMatchCandidate {
  readonly id: string;
  readonly contactIds: readonly [ContactId, ContactId];
  readonly matrix: ContactMatchMatrix;
  readonly probability: number;
  readonly band: 'recommended' | 'careful-review' | 'not-suggested';
  readonly scoringMode: 'deterministic' | 'model';
}

export interface ContactProbabilityModel {
  readonly version: string;
  score(matrix: ContactMatchMatrix): Promise<number>;
}

export interface ContactMatchAnalysis {
  readonly candidates: readonly ContactMatchCandidate[];
  readonly comparedPairCount: number;
  readonly isTruncated: boolean;
  readonly scoringMode: 'deterministic' | 'model';
}

export const DEFAULT_CONTACT_MATCH_PAIR_LIMIT = 2_000;
const MAX_BLOCK_SIZE = 50;

function normalizeText(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function diceSimilarity(left: string, right: string): number | null {
  if (!left || !right) return null;
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;
  const leftPairs = new Map<string, number>();
  for (let index = 0; index < left.length - 1; index += 1) {
    const pair = left.slice(index, index + 2);
    leftPairs.set(pair, (leftPairs.get(pair) ?? 0) + 1);
  }
  let overlap = 0;
  for (let index = 0; index < right.length - 1; index += 1) {
    const pair = right.slice(index, index + 2);
    const count = leftPairs.get(pair) ?? 0;
    if (count > 0) {
      overlap += 1;
      leftPairs.set(pair, count - 1);
    }
  }
  return (2 * overlap) / (left.length + right.length - 2);
}

function bestSimilarity(left: readonly string[], right: readonly string[]): number | null {
  if (left.length === 0 || right.length === 0) return null;
  let best = 0;
  for (const leftValue of left) {
    for (const rightValue of right) {
      best = Math.max(best, diceSimilarity(normalizeText(leftValue), normalizeText(rightValue)) ?? 0);
    }
  }
  return best;
}

function exactOverlap(left: readonly string[], right: readonly string[]): number | null {
  if (left.length === 0 || right.length === 0) return null;
  const rightValues = new Set(right);
  return left.some((value) => rightValues.has(value)) ? 1 : 0;
}

function phoneDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function phoneCountry(value: CanonicalContact['phoneNumbers'][number]['value']): string | null {
  if (value.countryCode) return value.countryCode.replace(/\D/g, '') || null;
  const raw = value.raw.trim();
  if (!raw.startsWith('+')) return null;
  const digits = phoneDigits(raw);
  // Country codes are 1–3 digits; without a phone metadata library only compare an explicit
  // leading code when both contacts provide one. Never infer disagreement from local numbers.
  return digits.length > 10 ? digits.slice(0, digits.length - 10) || null : null;
}

function compatibleExactValues(left: readonly string[], right: readonly string[]): number | null {
  if (left.length === 0 || right.length === 0) return null;
  return exactOverlap(left, right);
}

function emailParts(values: readonly string[], part: 'local' | 'domain'): readonly string[] {
  return values.flatMap((value) => {
    const separator = value.lastIndexOf('@');
    if (separator <= 0 || separator === value.length - 1) return [];
    return [part === 'local' ? value.slice(0, separator) : value.slice(separator + 1)];
  });
}

function structuredNameValues(contact: CanonicalContact, key: 'givenName' | 'familyName'): readonly string[] {
  const value = normalizeText(contact.name?.[key]);
  return value ? [value] : [];
}

function phoneticNameValues(contact: CanonicalContact): readonly string[] {
  const value = normalizeText([
    contact.name?.phoneticGivenName,
    contact.name?.phoneticMiddleName,
    contact.name?.phoneticFamilyName,
  ].filter(Boolean).join(' '));
  return value ? [value] : [];
}

function reversedNameSimilarity(left: CanonicalContact, right: CanonicalContact): number | null {
  const leftGiven = normalizeText(left.name?.givenName);
  const leftFamily = normalizeText(left.name?.familyName);
  const rightGiven = normalizeText(right.name?.givenName);
  const rightFamily = normalizeText(right.name?.familyName);
  if (!leftGiven || !leftFamily || !rightGiven || !rightFamily) return null;
  return Math.min(
    diceSimilarity(leftGiven, rightFamily) ?? 0,
    diceSimilarity(leftFamily, rightGiven) ?? 0,
  );
}

function nameValues(contact: CanonicalContact): readonly string[] {
  return [contact.displayName, [
    contact.name?.givenName,
    contact.name?.middleName,
    contact.name?.familyName,
  ].filter(Boolean).join(' ')].map(normalizeText).filter(Boolean);
}

function organizationValues(contact: CanonicalContact): readonly string[] {
  return contact.organizations.flatMap(({ value }) =>
    [value.name, value.department].map(normalizeText).filter(Boolean));
}

function addressValues(contact: CanonicalContact): readonly string[] {
  return contact.postalAddresses.flatMap(({ value }) =>
    [value.formatted, [value.street, value.city, value.region, value.postalCode, value.country]
      .filter(Boolean).join(' ')].map(normalizeText).filter(Boolean));
}

export function createContactMatchMatrix(
  left: CanonicalContact,
  right: CanonicalContact,
): ContactMatchMatrix {
  const leftPhones = left.phoneNumbers.flatMap(({ value }) => {
    const normalized = normalizePhoneForExactMatch(value);
    return normalized ? [normalized] : [];
  });
  const rightPhones = right.phoneNumbers.flatMap(({ value }) => {
    const normalized = normalizePhoneForExactMatch(value);
    return normalized ? [normalized] : [];
  });
  const leftPhoneSuffixes = leftPhones.map(phoneDigits).filter((value) => value.length >= 7).map((value) => value.slice(-7));
  const rightPhoneSuffixes = rightPhones.map(phoneDigits).filter((value) => value.length >= 7).map((value) => value.slice(-7));
  const leftPhoneCountries = left.phoneNumbers.flatMap(({ value }) => phoneCountry(value) ? [phoneCountry(value)!] : []);
  const rightPhoneCountries = right.phoneNumbers.flatMap(({ value }) => phoneCountry(value) ? [phoneCountry(value)!] : []);
  const leftEmails = left.emailAddresses.flatMap(({ value }) => {
    const normalized = normalizeEmailForExactMatch(value);
    return normalized ? [normalized] : [];
  });
  const rightEmails = right.emailAddresses.flatMap(({ value }) => {
    const normalized = normalizeEmailForExactMatch(value);
    return normalized ? [normalized] : [];
  });

  const values: readonly [ContactMatchFeatureKind, number | null, string][] = [
    ['phone', exactOverlap(leftPhones, rightPhones), 'phone number'],
    ['phoneSuffix', exactOverlap(leftPhoneSuffixes, rightPhoneSuffixes), 'phone suffix'],
    ['phoneCountry', compatibleExactValues(leftPhoneCountries, rightPhoneCountries), 'phone country code'],
    ['email', exactOverlap(leftEmails, rightEmails), 'email address'],
    ['emailLocalPart', bestSimilarity(emailParts(leftEmails, 'local'), emailParts(rightEmails, 'local')), 'email username'],
    ['emailDomain', exactOverlap(emailParts(leftEmails, 'domain'), emailParts(rightEmails, 'domain')), 'email domain'],
    ['name', bestSimilarity(nameValues(left), nameValues(right)), 'name'],
    ['givenName', bestSimilarity(structuredNameValues(left, 'givenName'), structuredNameValues(right, 'givenName')), 'given name'],
    ['familyName', bestSimilarity(structuredNameValues(left, 'familyName'), structuredNameValues(right, 'familyName')), 'family name'],
    ['nameOrder', reversedNameSimilarity(left, right), 'reordered name'],
    ['phoneticName', bestSimilarity(phoneticNameValues(left), phoneticNameValues(right)), 'phonetic name'],
    ['nickname', bestSimilarity(left.nicknames.map(({ value }) => value), right.nicknames.map(({ value }) => value)), 'nickname'],
    ['organization', bestSimilarity(organizationValues(left), organizationValues(right)), 'organization'],
    ['address', bestSimilarity(addressValues(left), addressValues(right)), 'address'],
    ['sameSource', left.recordRef.source.kind === right.recordRef.source.kind ? 1 : 0, 'contact source'],
  ];
  const features = values.map(([kind, score, label]): ContactMatchFeature => ({
    kind,
    score,
    isConflict: score !== null && score < 0.25,
    explanation: score === null
      ? `No ${label} on both contacts`
      : score === 1
        ? `Same ${label}`
        : score >= 0.7
          ? `Similar ${label}`
          : `Different ${label}`,
  }));
  return Object.freeze({
    schemaVersion: 1,
    contactIds: Object.freeze([left.id, right.id]) as readonly [ContactId, ContactId],
    features: Object.freeze(features),
  });
}

export function deterministicContactMatchProbability(matrix: ContactMatchMatrix): number {
  const feature = (kind: ContactMatchFeatureKind) =>
    matrix.features.find((candidate) => candidate.kind === kind)?.score ?? null;
  const phone = feature('phone');
  const email = feature('email');
  const name = feature('name');
  const nickname = feature('nickname');
  const organization = feature('organization');
  const address = feature('address');
  const phoneSuffix = feature('phoneSuffix');
  const phoneCountry = feature('phoneCountry');
  const givenName = feature('givenName');
  const familyName = feature('familyName');
  const phoneticName = feature('phoneticName');

  let score = 0;
  if (phone === 1) score += 0.58;
  if (email === 1) score += 0.62;
  if (name !== null) score += 0.28 * name;
  if (nickname !== null) score += 0.1 * nickname;
  if (organization !== null) score += 0.12 * organization;
  if (address !== null) score += 0.12 * address;
  if (phoneSuffix === 1 && phoneCountry !== 0 && (name ?? 0) >= 0.7) score += 0.18;
  if (givenName !== null && familyName !== null) score += 0.05 * Math.min(givenName, familyName);
  if (phoneticName !== null) score += 0.06 * phoneticName;
  if (name !== null && name < 0.25) score -= 0.2;
  const bounded = Math.max(0, Math.min(0.99, score));
  return hasContactIdentityConflict(matrix) ? Math.min(0.49, bounded) : bounded;
}

export function hasSharedPhoneWithDifferentGivenNames(matrix: ContactMatchMatrix): boolean {
  const score = (kind: ContactMatchFeatureKind) =>
    matrix.features.find((feature) => feature.kind === kind)?.score ?? null;
  const givenName = score('givenName');
  const familyName = score('familyName');
  return score('phone') === 1 && score('email') !== 1 &&
    givenName !== null && familyName !== null && givenName < 0.5;
}

export function hasContactIdentityConflict(matrix: ContactMatchMatrix): boolean {
  const score = (kind: ContactMatchFeatureKind) =>
    matrix.features.find((feature) => feature.kind === kind)?.score ?? null;
  const givenName = score('givenName');
  const familyName = score('familyName');
  const hasExactIdentifier = score('phone') === 1 || score('email') === 1;
  const surnameOnlySimilarity = !hasExactIdentifier && givenName !== null && familyName !== null &&
    givenName < 0.7;
  return surnameOnlySimilarity || hasSharedPhoneWithDifferentGivenNames(matrix);
}

function candidateKeys(contact: CanonicalContact): readonly string[] {
  const keys = new Set<string>();
  for (const { value } of contact.phoneNumbers) {
    const phone = normalizePhoneForExactMatch(value);
    if (phone) {
      keys.add(`phone:${phone}`);
      keys.add(`phone-suffix:${phone.replace(/\D/g, '').slice(-7)}`);
    }
  }
  for (const { value } of contact.emailAddresses) {
    const email = normalizeEmailForExactMatch(value);
    if (email) keys.add(`email:${email}`);
  }
  const name = normalizeText(contact.displayName);
  const tokens = name.split(' ').filter(Boolean);
  if (tokens.length > 0) keys.add(`name:${tokens.at(-1)?.slice(0, 3)}:${tokens[0]?.slice(0, 3)}`);
  for (const organization of organizationValues(contact)) {
    if (name) keys.add(`org-name:${organization}:${name.charAt(0)}`);
  }
  return [...keys];
}

function boundedCandidatePairs(
  contacts: readonly CanonicalContact[],
  pairLimit: number,
  focusContactIds?: ReadonlySet<ContactId>,
): { readonly pairs: readonly [CanonicalContact, CanonicalContact][]; readonly isTruncated: boolean } {
  const blocks = new Map<string, CanonicalContact[]>();
  for (const contact of contacts) {
    for (const key of candidateKeys(contact)) {
      const block = blocks.get(key) ?? [];
      if (block.length < MAX_BLOCK_SIZE) block.push(contact);
      blocks.set(key, block);
    }
  }
  const pairMap = new Map<string, [CanonicalContact, CanonicalContact]>();
  let isTruncated = false;
  scan: for (const block of blocks.values()) {
    for (let left = 0; left < block.length; left += 1) {
      for (let right = left + 1; right < block.length; right += 1) {
        const pair = [block[left], block[right]].sort((a, b) => a.id.localeCompare(b.id)) as [CanonicalContact, CanonicalContact];
        if (focusContactIds && !pair.some(({ id }) => focusContactIds.has(id))) continue;
        const key = `${pair[0].id}\u0000${pair[1].id}`;
        if (!pairMap.has(key) && pairMap.size >= pairLimit) {
          isTruncated = true;
          break scan;
        }
        pairMap.set(key, pair);
      }
    }
  }
  return { pairs: [...pairMap.values()], isTruncated };
}

export async function analyzeContactMatches(
  snapshot: ContactSnapshot,
  options: {
    readonly model?: ContactProbabilityModel;
    readonly pairLimit?: number;
    readonly focusContactIds?: ReadonlySet<ContactId>;
  } = {},
): Promise<ContactMatchAnalysis> {
  const pairLimit = options.pairLimit ?? DEFAULT_CONTACT_MATCH_PAIR_LIMIT;
  if (!Number.isSafeInteger(pairLimit) || pairLimit <= 0) throw new Error('Contact match pair limit must be a positive integer.');
  const focusContactIds = options.focusContactIds;
  const generated = boundedCandidatePairs(snapshot.contacts, pairLimit, focusContactIds);
  const pairs = generated.pairs;
  const candidates = await Promise.all(pairs.map(async ([left, right]): Promise<ContactMatchCandidate> => {
    const matrix = createContactMatchMatrix(left, right);
    const rawProbability = options.model
      ? await options.model.score(matrix)
      : deterministicContactMatchProbability(matrix);
    const boundedProbability = Math.max(0, Math.min(0.99, rawProbability));
    const probability = hasContactIdentityConflict(matrix)
      ? Math.min(0.49, boundedProbability)
      : boundedProbability;
    return Object.freeze({
      id: matrix.contactIds.join('\u0000'),
      contactIds: matrix.contactIds,
      matrix,
      probability,
      band: probability >= 0.85 ? 'recommended' : probability >= 0.62 ? 'careful-review' : 'not-suggested',
      scoringMode: options.model ? 'model' : 'deterministic',
    });
  }));
  candidates.sort((left, right) => right.probability - left.probability || left.id.localeCompare(right.id));
  return Object.freeze({
    candidates: Object.freeze(candidates),
    comparedPairCount: pairs.length,
    isTruncated: generated.isTruncated,
    scoringMode: options.model ? 'model' : 'deterministic',
  });
}
