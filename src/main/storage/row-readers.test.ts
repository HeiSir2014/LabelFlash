import { describe, expect, test } from 'bun:test';
import { readStringArray } from './row-readers';

describe('readStringArray', () => {
  test('reads a JSON array of strings', () => {
    expect(readStringArray({ cells: '["A-01","一号仓",""]' }, 'cells')).toEqual(['A-01', '一号仓', '']);
  });

  test('fails loudly on anything else', () => {
    expect(() => readStringArray({ cells: '["A", 1]' }, 'cells')).toThrow(TypeError);
    expect(() => readStringArray({ cells: '{"a":"b"}' }, 'cells')).toThrow(TypeError);
    expect(() => readStringArray({ cells: 42 }, 'cells')).toThrow(TypeError);
    expect(() => readStringArray({ cells: 'not json' }, 'cells')).toThrow();
  });
});
