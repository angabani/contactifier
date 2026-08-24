import {
  acceptedConfirmationTypes,
  defaultContactConfirmationPreferences,
  requiresContactConfirmation,
} from '@/application';
import { createConfidenceScore, type CanonicalContact, type ChangeSet } from '@/domain';

const contact: CanonicalContact = {
  id: 'contact', recordRef: { source: { kind: 'device' }, sourceContactId: 'native' },
  displayName: 'Contact', name: { givenName: 'Contact' }, nicknames: [], phoneNumbers: [],
  emailAddresses: [], postalAddresses: [], organizations: [], urls: [], birthdays: [], events: [],
  notes: [], groups: [], photos: [], extensions: {},
};

const changeSet: ChangeSet = {
  id: 'changes', snapshotId: 'snapshot', createdAt: '2026-08-20T00:00:00.000Z',
  changes: [
    { id: 'merge', kind: 'merge', contactIds: ['contact'], before: [contact], after: contact,
      origin: 'rule', confidence: createConfidenceScore(1), reasons: [], decision: 'accepted' },
    { id: 'delete', kind: 'delete', contactId: 'contact', before: contact,
      origin: 'rule', confidence: createConfidenceScore(1), reasons: [], decision: 'accepted' },
    { id: 'later', kind: 'update', contactId: 'contact', before: contact, after: contact,
      origin: 'rule', confidence: createConfidenceScore(1), reasons: [], decision: 'skipped' },
  ],
};

describe('contact confirmation policy', () => {
  it('uses only accepted change types and defaults to confirmation', () => {
    const types = acceptedConfirmationTypes(changeSet);
    expect(types).toEqual(['merge', 'delete']);
    expect(requiresContactConfirmation({ types, preferences: defaultContactConfirmationPreferences }))
      .toBe(true);
  });

  it('requires confirmation when any type remains protected', () => {
    const preferences = { ...defaultContactConfirmationPreferences, merge: false };
    expect(requiresContactConfirmation({ types: ['merge', 'delete'], preferences })).toBe(true);
    expect(requiresContactConfirmation({
      types: ['merge', 'delete'], preferences, sessionConfirmedTypes: new Set(['delete']),
    })).toBe(false);
  });
});
