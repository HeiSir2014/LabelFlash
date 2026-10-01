import { describe, expect, test } from 'bun:test';
import { BATCH_ID_PATTERN, batchIdFor, NO_SOURCE, sourceOf } from './batch-model';

describe('batchIdFor', () => {
  test('stamps the local start time to the second and adds four random hex digits', () => {
    const id = batchIdFor(new Date(2026, 9, 2, 14, 35, 1), 'a1b2');
    expect(id).toBe('20261002-143501-a1b2');
    expect(BATCH_ID_PATTERN.test(id)).toBe(true);
  });

  test('fails fast on a suffix that is not four hex digits', () => {
    expect(() => batchIdFor(new Date(2026, 9, 2), 'xyz')).toThrow('batch id suffix');
  });
});

describe('sourceOf', () => {
  test('reads only own entries, so names like __proto__ are not taken from the prototype', () => {
    expect(sourceOf({ 编码: { kind: 'column', column: '编码' } }, '编码')).toEqual({ kind: 'column', column: '编码' });
    expect(sourceOf({}, '__proto__')).toBe(NO_SOURCE);
  });
});
