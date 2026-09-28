import { describe, expect, test } from 'bun:test';
import { RepeatFilter } from './repeat-filter';

describe('RepeatFilter', () => {
  test('drops the same value inside the interval and accepts it afterwards', () => {
    let now = 0;
    const filter = new RepeatFilter(1_000, () => now);
    expect(filter.shouldAccept('A')).toBe(true);
    now = 999;
    expect(filter.shouldAccept('A')).toBe(false);
    now = 1_000;
    expect(filter.shouldAccept('A')).toBe(true);
  });

  test('always accepts a different value', () => {
    const filter = new RepeatFilter(1_000, () => 0);
    expect(filter.shouldAccept('A')).toBe(true);
    expect(filter.shouldAccept('B')).toBe(true);
    expect(filter.shouldAccept('A')).toBe(true);
  });
});
