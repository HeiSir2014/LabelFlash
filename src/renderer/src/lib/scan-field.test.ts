import { describe, expect, test } from 'bun:test';
import {
  fromDisplay,
  LINE_BREAK_MARK,
  pasteInto,
  scanFieldType,
  selectionParts,
  TAB_MARK,
  toDisplay,
} from './scan-field';

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

describe('pasteInto', () => {
  // 单行输入框自己粘贴时会把换行删掉：多行的码粘进来就变了。
  test('keeps the line breaks of a pasted multi-line code as marks', () => {
    expect(pasteInto('', 0, 0, '编码：CL5887\r\n颜色：灰色')).toBe(`编码：CL5887${LINE_BREAK_MARK}颜色：灰色`);
  });

  // 从表格里复制一格，末尾总带着换行；它不是码的一部分。
  test('drops the line break a spreadsheet adds after the copied cell', () => {
    expect(pasteInto('', 0, 0, 'CL5887\r\n')).toBe('CL5887');
  });

  test('replaces the selected part and keeps the rest', () => {
    expect(pasteInto('AB-XX-CD', 3, 5, 'M\tL')).toBe(`AB-M${TAB_MARK}L-CD`);
  });
});

// 透明的密码框自己的光标和选区看不见：文字层按真实的选区画出选中的部分和光标。
describe('selectionParts', () => {
  test('puts the caret where the real caret is', () => {
    expect(selectionParts('CL5887-M', 2, 2)).toEqual({ before: 'CL', selected: '', after: '5887-M' });
  });

  test('marks the selected part, for example after a double click selects everything', () => {
    expect(selectionParts('CL5887-M', 0, 8)).toEqual({ before: '', selected: 'CL5887-M', after: '' });
  });

  test('keeps the caret at the end when the field has not reported a selection yet', () => {
    expect(selectionParts('CL5887', null, null)).toEqual({ before: 'CL5887', selected: '', after: '' });
  });

  test('stays within the text when the selection is out of date', () => {
    expect(selectionParts('AB', 5, 9)).toEqual({ before: 'AB', selected: '', after: '' });
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
