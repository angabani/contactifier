export class DomainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainValidationError';
  }
}

export function assertDomain(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new DomainValidationError(message);
  }
}
