import { assertDomain } from '../shared/invariant';

export interface ContactDate {
  readonly year?: number;
  readonly month: number;
  readonly day: number;
}

export function createContactDate(input: ContactDate): ContactDate {
  assertDomain(Number.isInteger(input.month), 'Contact date month must be an integer.');
  assertDomain(Number.isInteger(input.day), 'Contact date day must be an integer.');
  assertDomain(
    input.year === undefined || Number.isInteger(input.year),
    'Contact date year must be an integer when provided.',
  );

  const validationYear = input.year ?? 2000;
  const date = new Date(Date.UTC(validationYear, input.month - 1, input.day));
  const isValid =
    input.month >= 1 &&
    input.month <= 12 &&
    input.day >= 1 &&
    date.getUTCFullYear() === validationYear &&
    date.getUTCMonth() === input.month - 1 &&
    date.getUTCDate() === input.day;

  assertDomain(isValid, 'Contact date must be a valid calendar date.');
  return Object.freeze({ ...input });
}
