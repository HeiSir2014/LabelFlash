import { describe, expect, test } from 'bun:test';
import { deepEqual } from './deep-equal';

describe('deepEqual', () => {
  test('ignores key order but not array order', () => {
    expect(deepEqual({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 })).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
  });

  test('tells apart different values, missing keys and null', () => {
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(deepEqual({ a: null }, { a: {} })).toBe(false);
    expect(deepEqual([], {})).toBe(false);
    expect(deepEqual('x', 'x')).toBe(true);
  });
});
