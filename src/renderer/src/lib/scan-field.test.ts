import { describe, expect, test } from 'bun:test';
import { fromDisplay, LINE_BREAK_MARK, scanFieldType, TAB_MARK, toDisplay } from './scan-field';

describe('toDisplay / fromDisplay', () => {
  test('shows line breaks and tabs inside a code as visible marks', () => {
    expect(toDisplay('编码：CL5887\n颜色：灰色\tM')).toBe(`编码：CL5887${LINE_BREAK_MARK}颜色：灰色${TAB_MARK}M`);
  });

  test('turns the marks back into the original content', () => {
    const content = 'A\nB\tC\n';
    expect(fromDisplay(toDisplay(content))).toBe(content);
  });

  test('leaves a single-line code unchanged', () => {
    expect(toDisplay('CL5887-灰色-M')).toBe('CL5887-灰色-M');
    expect(fromDisplay('CL5887-灰色-M')).toBe('CL5887-灰色-M');
  });
});

describe('scanFieldType', () => {
  // Chromium 只在密码框里关掉输入法：中文模式下扫码枪的字母会被输入法截走、数字选了候选词，回车只用来上屏。
  test('uses a password field on Windows so the input method cannot take the scanner keys', () => {
    expect(scanFieldType('other')).toBe('password');
  });

  // macOS 的密码框会打开系统的「安全输入」，对扫码枪输出中文的影响还没在真机上验证过。
  test('keeps a plain text field on macOS', () => {
    expect(scanFieldType('mac')).toBe('text');
  });
});
