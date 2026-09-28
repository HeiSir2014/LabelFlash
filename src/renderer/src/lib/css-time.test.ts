import { describe, expect, test } from 'bun:test';
import { parseCssTime } from './css-time';

describe('parseCssTime', () => {
  test('reads milliseconds and seconds', () => {
    expect(parseCssTime('160ms')).toBe(160);
    expect(parseCssTime(' 0.16s ')).toBe(160);
    expect(parseCssTime('0ms')).toBe(0);
  });

  test('returns null for anything else', () => {
    expect(parseCssTime('')).toBeNull();
    expect(parseCssTime('fast')).toBeNull();
    expect(parseCssTime('-1ms')).toBeNull();
    expect(parseCssTime('160')).toBeNull();
  });
});
