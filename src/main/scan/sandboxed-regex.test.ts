import { describe, expect, test } from 'bun:test';
import { createSandboxedRegexReplacer, createSandboxedRegexRunner } from './sandboxed-regex';

describe('createSandboxedRegexReplacer', () => {
  test('replaces the first match, or every match with the g flag, with $ references', () => {
    const replace = createSandboxedRegexReplacer(50, () => {});
    expect(replace('^SO-', '', 'SO-123', '')).toBe('123');
    expect(replace('-', 'g', 'a-b-c', '/')).toBe('a/b/c');
    expect(replace('(?<年>\\d{4})(?<月>\\d{2})', '', '202609', '$<月>/$<年>')).toBe('09/2026');
    expect(replace('x', '', 'abc', 'y')).toBe('abc');
  });

  test('gives up on catastrophic backtracking', () => {
    const replace = createSandboxedRegexReplacer(50, () => {});
    expect(replace('^(a+)+$', '', `${'a'.repeat(40)}!`, '')).toBeNull();
  });
});

describe('createSandboxedRegexRunner', () => {
  test('returns named groups on a match and null otherwise', () => {
    const run = createSandboxedRegexRunner(50, () => {});
    expect(run('^(?<款号>\\w+)#(?<尺码>\\w+)$', '', 'CL1#XL')).toEqual({ 款号: 'CL1', 尺码: 'XL' });
    expect(run('^(?<款号>\\w+)#(?<尺码>\\w+)$', '', 'CL1-XL')).toBeNull();
  });

  test('drops optional groups that did not take part in the match', () => {
    const run = createSandboxedRegexRunner(50, () => {});
    expect(run('^(?<款号>\\w+)(?:#(?<尺码>\\w+))?$', '', 'CL1')).toEqual({ 款号: 'CL1' });
  });

  test('gives up on catastrophic backtracking instead of freezing the app', () => {
    const warnings: string[] = [];
    const run = createSandboxedRegexRunner(50, (message) => warnings.push(message));
    const startedAt = Date.now();
    expect(run('^(?<内容>(a+)+)$', '', `${'a'.repeat(40)}!`)).toBeNull();
    // Bun 打断得比 Electron 慢（实测约 0.4 秒对 50ms），这里只保证不会卡住。
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(warnings).toHaveLength(1);
  });
});
