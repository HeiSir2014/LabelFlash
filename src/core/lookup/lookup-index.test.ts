import { describe, expect, test } from 'bun:test';
import { LookupIndex } from './lookup-index';
import type { LookupTableData } from './lookup-model';

const SHELVES: LookupTableData = {
  columns: ['编码', '货架'],
  rows: [
    ['CL5640-TK', 'A-01'],
    [' cl5640-tk ', 'A-99'],
    ['CL7788', 'B-02'],
    ['', 'Z-00'],
  ],
};

function createIndex(data: LookupTableData | null = SHELVES) {
  let loads = 0;
  const index = new LookupIndex(() => {
    loads += 1;
    return data;
  });
  return { index, loads: () => loads };
}

describe('LookupIndex', () => {
  test('matches the key exactly after trimming, first row wins', () => {
    const { index } = createIndex();
    expect(index.find('t', '编码', ' CL5640-TK ', false)).toEqual({ 编码: 'CL5640-TK', 货架: 'A-01' });
    expect(index.find('t', '编码', 'cl5640-tk', false)).toEqual({ 编码: ' cl5640-tk ', 货架: 'A-99' });
    expect(index.find('t', '编码', 'cl7788', false)).toBeNull();
  });

  test('can ignore case', () => {
    const { index } = createIndex();
    expect(index.find('t', '编码', 'cl7788', true)?.['货架']).toBe('B-02');
    expect(index.find('t', '编码', 'CL5640-tk', true)?.['货架']).toBe('A-01');
  });

  test('never matches an empty key', () => {
    const { index } = createIndex();
    expect(index.find('t', '编码', '', false)).toBeNull();
  });

  test('loads a table once per column until it is invalidated', () => {
    const { index, loads } = createIndex();
    index.find('t', '编码', 'CL7788', false);
    index.find('t', '编码', 'CL5640-TK', false);
    expect(loads()).toBe(1);
    index.find('t', '货架', 'B-02', false);
    expect(loads()).toBe(2);
    index.invalidate('t');
    index.find('t', '编码', 'CL7788', false);
    expect(loads()).toBe(3);
  });

  test('returns null for a missing table or column', () => {
    expect(createIndex(null).index.find('t', '编码', 'x', false)).toBeNull();
    expect(createIndex().index.find('t', '库位', 'x', false)).toBeNull();
  });
});
