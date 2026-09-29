import { describe, expect, test } from 'bun:test';
import { parseBuildNumber } from './build-info';

describe('parseBuildNumber', () => {
  test('reads the CI run number', () => {
    expect(parseBuildNumber('123')).toBe('123');
  });

  test('treats a build without a number as a local build', () => {
    expect(parseBuildNumber('')).toBeNull();
    expect(parseBuildNumber(null)).toBeNull();
  });

  // Windows 的文件版本每段是 0–65535 的整数：不是纯数字的值进不去，也不该显示出来。
  test('ignores values that are not a plain number', () => {
    expect(parseBuildNumber('12a')).toBeNull();
    expect(parseBuildNumber('-1')).toBeNull();
    expect(parseBuildNumber('70000')).toBeNull();
  });
});
