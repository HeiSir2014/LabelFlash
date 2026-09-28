import { describe, expect, test } from 'bun:test';
import { createSandboxedRegexRunner } from './sandboxed-regex';

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
