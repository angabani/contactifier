import { ContactDecorationConflictError, decorateProposedContact } from '@/application';
import { createConfidenceScore, type CanonicalContact, type ChangeSet } from '@/domain';

const contact: CanonicalContact = {
  id: 'a', recordRef: { source: { kind: 'device' }, sourceContactId: 'a' }, displayName: 'Ada',
  name: { givenName: 'Ada' }, nicknames: [], phoneNumbers: [], emailAddresses: [], postalAddresses: [],
  organizations: [], urls: [], birthdays: [], events: [], notes: [], groups: [], photos: [], extensions: {},
};
const changeSet: ChangeSet = {
  id: 'changes', snapshotId: 'snapshot', createdAt: '2026-08-23T00:00:00.000Z',
  changes: [{ id: 'update', kind: 'update', contactId: 'a', before: contact, after: contact,
    origin: 'user', confidence: createConfidenceScore(1), reasons: [], decision: 'accepted' }],
};

describe('contact decoration', () => {
  it('writes honorific and company into native structured fields immutably', () => {
    const honorific = decorateProposedContact({ changeSet, changeId: 'update', decoration: { kind: 'honorific', value: 'Dr.' } });
    expect(honorific.changes[0]).toMatchObject({ after: { name: { prefix: 'Dr.' } } });
    const company = decorateProposedContact({ changeSet, changeId: 'update', decoration: { kind: 'company', value: 'Contactifier' } });
    expect(company.changes[0]).toMatchObject({ after: { organizations: [{ value: { name: 'Contactifier' }, origin: 'user' }] } });
    expect(contact.name?.prefix).toBeUndefined();
  });

  it('refuses to overwrite a different existing structured value', () => {
    const decorated = { ...changeSet, changes: [{ ...changeSet.changes[0], after: { ...contact, name: { ...contact.name, prefix: 'Prof.' } } }] } as ChangeSet;
    expect(() => decorateProposedContact({ changeSet: decorated, changeId: 'update', decoration: { kind: 'honorific', value: 'Dr.' } }))
      .toThrow(ContactDecorationConflictError);
  });
});
