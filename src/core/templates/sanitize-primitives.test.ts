import { describe, expect, test } from 'bun:test';
import { asLoose, bool, clamp, pick, sanitizeText } from './sanitize-primitives';

describe('sanitize primitives', () => {
  test('asLoose accepts only plain objects', () => {
    expect(asLoose({ a: 1 })).toEqual({ a: 1 });
    expect(asLoose([1])).toEqual({});
    expect(asLoose(null)).toEqual({});
    expect(asLoose('x')).toEqual({});
  });

  test('bool falls back on anything that is not a boolean', () => {
    expect(bool(true, false)).toBe(true);
    expect(bool('true', false)).toBe(false);
  });

  test('clamp keeps finite numbers in range and falls back on the rest', () => {
    expect(clamp(5, 0, 3, 1)).toBe(3);
    expect(clamp(-1, 0, 3, 1)).toBe(0);
    expect(clamp(Number.NaN, 0, 3, 1)).toBe(1);
    expect(clamp('2', 0, 3, 1)).toBe(1);
  });

  test('pick only accepts listed values', () => {
    expect(pick('b', ['a', 'b'] as const, 'a')).toBe('b');
    expect(pick('c', ['a', 'b'] as const, 'a')).toBe('a');
  });

  test('pick works with numbers such as rotation angles', () => {
    expect(pick(90, [0, 90, 180, 270] as const, 0)).toBe(90);
    expect(pick(45, [0, 90, 180, 270] as const, 0)).toBe(0);
  });

  test('sanitizeText strips control characters, keeps line breaks and truncates', () => {
    expect(sanitizeText('a\u0007b\nc', 10, '')).toBe('ab\nc');
    expect(sanitizeText('abcdef', 3, '')).toBe('abc');
    expect(sanitizeText(3, 3, 'x')).toBe('x');
  });
});
