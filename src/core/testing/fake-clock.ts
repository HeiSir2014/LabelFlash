import type { Clock } from '../types';

export const FAKE_CLOCK_START = Date.UTC(2026, 8, 28, 9, 0, 0);

export class FakeClock implements Clock {
  private current: number;

  constructor(start: number = FAKE_CLOCK_START) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}
