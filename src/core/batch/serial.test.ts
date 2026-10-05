import { describe, expect, test } from 'bun:test';
import { DEFAULT_SERIAL } from './batch-model';
import { serialText } from './serial';

describe('serialText', () => {
  test('counts from the start by the step, zero-padded, with prefix and suffix', () => {
    const settings = { ...DEFAULT_SERIAL, prefix: 'A', start: 8, step: 2, digits: 3, suffix: '号' };
    expect([0, 1, 2].map((position) => serialText(settings, position))).toEqual(['A008号', 'A010号', 'A012号']);
  });

  test('does not pad when digits is 0 and never cuts a longer number', () => {
    expect(serialText({ ...DEFAULT_SERIAL, start: 1, digits: 0 }, 9)).toBe('10');
    expect(serialText({ ...DEFAULT_SERIAL, start: 1000, digits: 2 }, 0)).toBe('1000');
  });
});
