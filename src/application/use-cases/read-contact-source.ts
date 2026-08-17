import type { Clock } from '../ports/clock';
import type { ContactReader } from '../ports/contact-reader';
import type { IdGenerator } from '../ports/id-generator';
import {
  createContactSnapshot,
  type ContactSnapshot,
  type ContactSourceRef,
} from '@/domain';

export interface ReadContactSourceRequest {
  readonly source: ContactSourceRef;
}

export interface ReadContactSourceDependencies {
  readonly contactReader: ContactReader;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
}

export class ReadContactSource {
  constructor(private readonly dependencies: ReadContactSourceDependencies) {}

  async execute(request: ReadContactSourceRequest): Promise<ContactSnapshot> {
    const result = await this.dependencies.contactReader.readContacts(request.source);

    return createContactSnapshot({
      id: this.dependencies.idGenerator.nextId(),
      schemaVersion: 1,
      source: request.source,
      ...(result.accessScope ? { accessScope: result.accessScope } : {}),
      createdAt: this.dependencies.clock.now().toISOString(),
      sourceRevision: result.sourceRevision,
      contentHash: result.contentHash,
      contacts: result.contacts,
    });
  }
}
