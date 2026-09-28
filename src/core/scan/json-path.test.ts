import { describe, expect, test } from 'bun:test';
import { parseJsonPath, readJsonPath } from './json-path';

describe('parseJsonPath', () => {
  test('parses property names and array indexes', () => {
    expect(parseJsonPath('data.shelf')).toEqual(['data', 'shelf']);
    expect(parseJsonPath('items[0].name')).toEqual(['items', 0, 'name']);
    expect(parseJsonPath('[1]')).toEqual([1]);
    expect(parseJsonPath('货架.编号')).toEqual(['货架', '编号']);
  });

  test('rejects malformed paths', () => {
    for (const path of ['', '.a', 'a.', 'a..b', 'a[x]', 'a[0', 'a]', 'a[0]b']) {
      expect(parseJsonPath(path)).toBeNull();
    }
  });
});

describe('readJsonPath', () => {
  const body = { data: { shelf: 'A-01', count: 3, ok: true, none: null, list: [{ name: 'x' }] } };

  test('reads strings, numbers and booleans as text', () => {
    expect(readJsonPath(body, ['data', 'shelf'])).toBe('A-01');
    expect(readJsonPath(body, ['data', 'count'])).toBe('3');
    expect(readJsonPath(body, ['data', 'ok'])).toBe('true');
    expect(readJsonPath(body, ['data', 'list', 0, 'name'])).toBe('x');
  });

  test('returns null for missing values, null, objects and arrays', () => {
    expect(readJsonPath(body, ['data', 'missing'])).toBeNull();
    expect(readJsonPath(body, ['data', 'none'])).toBeNull();
    expect(readJsonPath(body, ['data'])).toBeNull();
    expect(readJsonPath(body, ['data', 'list'])).toBeNull();
    expect(readJsonPath(body, ['data', 'list', 5])).toBeNull();
    expect(readJsonPath(body, ['data', 'toString'])).toBeNull();
  });
});
