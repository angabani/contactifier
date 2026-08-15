import { ReadContactSource } from '@/application';
import type { Clock, ContactReader, IdGenerator } from '@/application';
import type { CanonicalContact, ContactSourceRef } from '@/domain';

const source: ContactSourceRef = { kind: 'device', containerId: 'personal' };

function contact(id: string, contactSource: ContactSourceRef = source): CanonicalContact {
  return {
    id,
    recordRef: { source: contactSource, sourceContactId: id },
    displayName: `Contact ${id}`,
    nicknames: [],
    phoneNumbers: [],
    emailAddresses: [],
    postalAddresses: [],
    organizations: [],
    urls: [],
    birthdays: [],
    events: [],
    notes: [],
    groups: [],
    photos: [],
    extensions: {},
  };
}

function createUseCase(contactReader: ContactReader): ReadContactSource {
  const clock: Clock = { now: () => new Date('2026-08-15T12:00:00.000Z') };
  const idGenerator: IdGenerator = { nextId: () => 'snapshot-1' };
  return new ReadContactSource({ contactReader, clock, idGenerator });
}

describe('ReadContactSource', () => {
  it('reads through the port and returns a validated snapshot', async () => {
    const readContacts = jest
      .fn<
        ReturnType<ContactReader['readContacts']>,
        Parameters<ContactReader['readContacts']>
      >()
      .mockResolvedValue({
      contacts: [contact('one')],
      sourceRevision: 'revision-1',
      contentHash: 'hash-1',
      });

    const snapshot = await createUseCase({ readContacts }).execute({ source });

    expect(readContacts).toHaveBeenCalledWith(source);
    expect(snapshot).toEqual({
      id: 'snapshot-1',
      schemaVersion: 1,
      source,
      createdAt: '2026-08-15T12:00:00.000Z',
      sourceRevision: 'revision-1',
      contentHash: 'hash-1',
      contacts: [contact('one')],
    });
  });

  it('rejects adapter data from a different contact container', async () => {
    const contactReader: ContactReader = {
      readContacts: async () => ({
        contacts: [contact('one', { kind: 'device', containerId: 'work' })],
      }),
    };

    await expect(createUseCase(contactReader).execute({ source })).rejects.toThrow(
      'belongs to a different source',
    );
  });

  it('preserves source-reader failures for the caller to handle', async () => {
    const failure = new Error('Contacts permission denied');
    const contactReader: ContactReader = {
      readContacts: async () => Promise.reject(failure),
    };

    await expect(createUseCase(contactReader).execute({ source })).rejects.toBe(failure);
  });
});
