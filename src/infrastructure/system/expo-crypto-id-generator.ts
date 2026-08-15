import { randomUUID } from 'expo-crypto';

import type { IdGenerator } from '@/application';

export class ExpoCryptoIdGenerator implements IdGenerator {
  nextId(): string {
    return randomUUID();
  }
}
