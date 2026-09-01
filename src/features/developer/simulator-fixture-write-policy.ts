import type { CanonicalContact, ContactWritePlan } from '@/domain';

import { IOS_FIXTURE_MARKER_PREFIX, IOS_FIXTURE_NAME_PREFIX } from './ios-certification-fixtures';

function isOwnedFixture(contact: CanonicalContact): boolean {
  return (
    contact.name?.givenName?.startsWith(IOS_FIXTURE_NAME_PREFIX) === true &&
    contact.urls.some(({ value }) => value.startsWith(IOS_FIXTURE_MARKER_PREFIX))
  );
}

export function isSimulatorFixtureWritePlanOwned(plan: ContactWritePlan): boolean {
  return plan.operations.length > 0 && plan.operations.every((operation) => {
    const contacts = operation.kind === 'create'
      ? [operation.contact]
      : operation.kind === 'update'
        ? [operation.before, operation.after]
        : [operation.before];
    return contacts.every(isOwnedFixture);
  });
}

export function assertSimulatorFixtureWritePlan(plan: ContactWritePlan): void {
  if (plan.operations.length === 0) throw new Error('Simulator fixture plan has no operations.');
  if (isSimulatorFixtureWritePlanOwned(plan)) return;
  for (const operation of plan.operations) {
    const contacts = operation.kind === 'create'
      ? [operation.contact]
      : operation.kind === 'update'
        ? [operation.before, operation.after]
        : [operation.before];
    if (!contacts.every(isOwnedFixture)) {
      throw new Error(`Operation ${operation.id} contains a contact not owned by the simulator fixture set.`);
    }
  }
}
