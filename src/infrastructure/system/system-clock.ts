import type { Clock } from '@/application';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
