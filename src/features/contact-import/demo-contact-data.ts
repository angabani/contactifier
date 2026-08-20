import {
  createContactSnapshot,
  type BackupManifest,
  type CanonicalContact,
  type ContactValue,
} from '@/domain';

const source = { kind: 'device' as const, containerId: 'contactifier-demo' };

function value<T>(id: string, item: T, label?: string): ContactValue<T> {
  return { id, value: item, label, origin: 'source' };
}

function demoContact(
  id: string,
  displayName: string,
  options: {
    readonly phones?: readonly string[];
    readonly emails?: readonly string[];
    readonly company?: string;
    readonly note?: string;
    readonly trulyEmpty?: boolean;
  },
): CanonicalContact {
  return {
    id,
    recordRef: { source, sourceContactId: id, revision: 'demo-1' },
    displayName,
    name: options.trulyEmpty
      ? undefined
      : {
          givenName: displayName.split(' ')[0],
          familyName: displayName.split(' ').slice(1).join(' '),
        },
    nicknames: [],
    phoneNumbers: (options.phones ?? []).map((phone, index) =>
      value(`${id}:phone:${index}`, { raw: phone }, index === 0 ? 'mobile' : 'work'),
    ),
    emailAddresses: (options.emails ?? []).map((email, index) =>
      value(`${id}:email:${index}`, email, index === 0 ? 'home' : 'work'),
    ),
    postalAddresses: [],
    organizations: options.company
      ? [value(`${id}:company`, { name: options.company }, 'work')]
      : [],
    urls: [],
    birthdays: [],
    events: [],
    notes: options.note ? [value(`${id}:note`, options.note)] : [],
    groups: [],
    photos: [],
    extensions: options.trulyEmpty ? {} : { demo: true },
  };
}

export function createDemoContactSnapshot() {
  return createContactSnapshot({
    id: 'contactifier-demo-snapshot',
    schemaVersion: 1,
    source,
    createdAt: '2026-08-17T12:00:00.000Z',
    contacts: [
      demoContact('demo-priya-personal', 'Priya Sharma', {
        phones: ['+91 98765 43210'],
        emails: ['priya@example.com'],
      }),
      demoContact('demo-priya-work', 'Priya S.', {
        phones: ['+91-98765-43210'],
        emails: ['priya.sharma@acme.example'],
        company: 'Acme Design',
      }),
      demoContact('demo-arjun-phone', 'Arjun Mehta', {
        phones: ['+91 99887 76655'],
        emails: ['arjun.personal@example.com'],
      }),
      demoContact('demo-arjun-bridge', 'Arjun M.', {
        phones: ['+91-99887-76655'],
        emails: ['arjun@studio.example'],
        company: 'Studio North',
      }),
      demoContact('demo-arjun-email', 'A. Mehta', {
        phones: ['+91 90000 11111'],
        emails: ['ARJUN@STUDIO.EXAMPLE'],
        note: 'Met at the design conference',
      }),
      demoContact('demo-unique', 'Neha Kapoor', {
        phones: ['+91 91111 22222', '+91-91111-22222'],
        emails: [' neha@example.com ', 'NEHA@example.com'],
      }),
      demoContact('demo-empty', '', { trulyEmpty: true }),
    ],
  });
}

export function createDemoPreviousContactSnapshot() {
  const current = createDemoContactSnapshot();
  return createContactSnapshot({
    ...current,
    id: 'contactifier-demo-previous-snapshot',
    createdAt: '2026-08-10T12:00:00.000Z',
    contacts: [
      ...current.contacts
        .filter(
          ({ id }) =>
            id !== 'demo-empty' && id !== 'demo-priya-work' && id !== 'demo-unique',
        )
        .map((contact) =>
          contact.id === 'demo-arjun-phone'
            ? { ...contact, displayName: 'Arjun Old', name: { givenName: 'Arjun', familyName: 'Old' } }
            : contact,
        ),
      demoContact('demo-deleted', 'Rohan Verma', {
        phones: ['+91 92222 33333'],
        emails: ['rohan@example.com'],
      }),
    ],
  });
}

export function createDemoBackupManifest(): BackupManifest {
  const snapshot = createDemoContactSnapshot();
  return {
    id: 'contactifier-demo-backup',
    schemaVersion: 1,
    snapshotId: snapshot.id,
    snapshotCreatedAt: snapshot.createdAt,
    source: snapshot.source,
    createdAt: snapshot.createdAt,
    contactCount: snapshot.contacts.length,
    chunkContactLimit: 100,
    chunks: [
      {
        index: 0,
        fileName: 'chunk-000000.cfb',
        contactCount: snapshot.contacts.length,
        encryptedSizeInBytes: 1,
        sha256: '0'.repeat(64),
      },
    ],
    artifact: { uri: 'demo://contactifier', sizeInBytes: 1, sha256: '0'.repeat(64) },
    encryption: { algorithm: 'AES-256-GCM', keyAlias: 'demo-only' },
  };
}
