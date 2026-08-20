import { SimulatedContactWriter } from '@/infrastructure/contacts/simulation';

import { runContactWriterContract } from '../test-support/contact-writer-contract';

runContactWriterContract(
  'SimulatedContactWriter',
  (contacts) => new SimulatedContactWriter(contacts),
);
