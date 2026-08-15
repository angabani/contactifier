export type { Clock } from './ports/clock';
export type { ContactReader, ContactReadResult } from './ports/contact-reader';
export type { IdGenerator } from './ports/id-generator';
export {
  ReadContactSource,
  type ReadContactSourceDependencies,
  type ReadContactSourceRequest,
} from './use-cases/read-contact-source';
