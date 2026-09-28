import { describe, expect, test } from 'bun:test';
import { formatWindow } from './duration-text';

const MINUTE = 60_000;

describe('formatWindow', () => {
  test('uses the largest unit that divides evenly', () => {
    expect(formatWindow(3_000)).toBe('3 秒');
    expect(formatWindow(90_000)).toBe('90 秒');
    expect(formatWindow(10 * MINUTE)).toBe('10 分钟');
    expect(formatWindow(90 * MINUTE)).toBe('90 分钟');
    expect(formatWindow(120 * MINUTE)).toBe('2 小时');
  });
});
