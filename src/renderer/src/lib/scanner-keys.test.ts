import { describe, expect, test } from 'bun:test';
import { SCANNER_KEY_GAP_MS } from './scan-mode';
import { charForKey, type KeyStroke, ScannerRun } from './scanner-keys';

const KEY_GAP_MS = 5;

function stroke(code: string, options: Partial<KeyStroke> = {}): Omit<KeyStroke, 'at'> {
  return { code, key: 'Process', shift: false, caps: false, alt: false, ctrl: false, meta: false, ...options };
}

/** 按扫码枪的速度依次按下：返回每个键得到的处理方式。 */
function press(run: ScannerRun, strokes: Omit<KeyStroke, 'at'>[], startAt = 1_000, content = ''): string[] {
  return strokes.map((item, index) => run.keyDown({ ...item, at: startAt + index * KEY_GAP_MS }, content));
}

/** 微软拼音中文模式下扫「CL5887-M」+ 回车时收到的按键（实测）。 */
const PINYIN_SCAN = [
  stroke('KeyC', { shift: true }),
  stroke('ShiftLeft', { shift: true }),
  stroke('KeyL', { shift: true }),
  stroke('Digit5'),
  stroke('Digit8'),
  stroke('Digit8'),
  stroke('Digit7'),
  stroke('Minus'),
  stroke('ShiftLeft', { shift: true }),
  stroke('KeyM', { shift: true }),
  stroke('Enter'),
];

describe('charForKey', () => {
  test('reads letters with Shift and Caps Lock', () => {
    expect(charForKey(stroke('KeyC'))).toBe('c');
    expect(charForKey(stroke('KeyC', { shift: true }))).toBe('C');
    expect(charForKey(stroke('KeyC', { caps: true }))).toBe('C');
    expect(charForKey(stroke('KeyC', { shift: true, caps: true }))).toBe('c');
  });

  test('reads digits, their shifted symbols and punctuation like a US keyboard', () => {
    expect(charForKey(stroke('Digit5'))).toBe('5');
    expect(charForKey(stroke('Digit2', { shift: true }))).toBe('@');
    expect(charForKey(stroke('Minus'))).toBe('-');
    expect(charForKey(stroke('Slash', { shift: true }))).toBe('?');
    expect(charForKey(stroke('Numpad7'))).toBe('7');
  });

  test('turns Enter and Tab into line breaks and tabs', () => {
    expect(charForKey(stroke('Enter'))).toBe('\n');
    expect(charForKey(stroke('Tab'))).toBe('\t');
  });

  test('reads a modifier alone as nothing', () => {
    expect(charForKey(stroke('ShiftLeft', { shift: true }))).toBe('');
  });

  // 单独一个按住 Alt 的小键盘键不是字符：Alt 码要看整串（见 ScannerRun），功能键拼不出来。
  test('cannot read a single Alt-held key or unknown keys', () => {
    expect(charForKey(stroke('Numpad4', { alt: true }))).toBeNull();
    expect(charForKey(stroke('F5'))).toBeNull();
  });
});

describe('ScannerRun', () => {
  test('takes over a scan that the input method is intercepting', () => {
    const run = new ScannerRun();
    const decisions = press(run, PINYIN_SCAN);
    expect(decisions.slice(-1)).toEqual(['capture']);
    expect(run.finish()).toEqual({ kind: 'rebuilt', text: 'CL5887-M', contentBefore: '' });
  });

  test('keeps what was in the box before the scan started', () => {
    const run = new ScannerRun();
    press(run, PINYIN_SCAN, 1_000, '备注A');
    expect(run.finish()).toEqual({ kind: 'rebuilt', text: 'CL5887-M', contentBefore: '备注A' });
  });

  test('keeps line breaks inside a multi-line code', () => {
    const run = new ScannerRun();
    press(run, [stroke('KeyA'), stroke('Digit1'), stroke('Enter'), stroke('KeyB'), stroke('Digit2'), stroke('Enter')]);
    expect(run.finish()).toEqual({ kind: 'rebuilt', text: 'a1\nb2', contentBefore: '' });
  });

  // 输入法没插手（英文模式）：按键本来就是对的，交给正常的流程。
  test('leaves a fast burst alone when the input method is not involved', () => {
    const run = new ScannerRun();
    const decisions = press(run, [
      stroke('KeyA', { key: 'a' }),
      stroke('KeyB', { key: 'b' }),
      stroke('KeyC', { key: 'c' }),
      stroke('KeyD', { key: 'd' }),
      stroke('Enter', { key: 'Enter' }),
    ]);
    expect(decisions.every((decision) => decision === 'pass')).toBe(true);
    expect(run.finish()).toEqual({ kind: 'none' });
  });

  // 人打拼音：键和键之间远比扫码枪慢，不接管。
  test('leaves typing alone', () => {
    const run = new ScannerRun();
    const decisions = ['KeyN', 'KeyI', 'KeyH', 'KeyA', 'KeyO', 'Space'].map((code, index) =>
      run.keyDown({ ...stroke(code), at: 1_000 + index * (SCANNER_KEY_GAP_MS * 3) }, ''),
    );
    expect(decisions.every((decision) => decision === 'pass')).toBe(true);
    expect(run.finish()).toEqual({ kind: 'none' });
  });

  // 没有以回车或 Tab 结尾：可能是很快地打字，不自动提交。
  test('does not submit a fast burst without Enter or Tab at the end', () => {
    const run = new ScannerRun();
    press(run, [stroke('KeyA'), stroke('KeyB'), stroke('KeyC'), stroke('KeyD'), stroke('KeyE')]);
    expect(run.finish()).toEqual({ kind: 'unreadable' });
  });

  /** 扫码枪输出中文：按住 Alt，在小键盘上敲 GBK 编码的十进制值（「灰」= 0xBBD2 = 48082）。 */
  function altCode(decimal: string): Omit<KeyStroke, 'at'>[] {
    return [stroke('AltLeft', { alt: true }), ...[...decimal].map((digit) => stroke(`Numpad${digit}`, { alt: true }))];
  }

  // 实测：输入法开着时 Alt 和小键盘的 keydown 照样带着 code 和 Alt，输入法把字弄成了「╥」。
  test('turns Alt codes from a scanner back into Chinese characters', () => {
    const run = new ScannerRun();
    press(run, [
      stroke('KeyC', { shift: true }),
      stroke('KeyL', { shift: true }),
      stroke('Digit5'),
      stroke('Minus'),
      ...altCode('48082'),
      ...altCode('51627'),
      stroke('Minus'),
      stroke('KeyM', { shift: true }),
      stroke('Enter'),
    ]);
    expect(run.finish()).toEqual({ kind: 'rebuilt', text: 'CL5-灰色-M', contentBefore: '' });
  });

  test('reads an Alt code below 128 as the plain character', () => {
    const run = new ScannerRun();
    press(run, [stroke('KeyA'), stroke('KeyB'), ...altCode('65'), stroke('KeyC'), stroke('Enter')]);
    expect(run.finish()).toEqual({ kind: 'rebuilt', text: 'abAc', contentBefore: '' });
  });

  test('does not guess an Alt code that is not a whole character', () => {
    const run = new ScannerRun();
    press(run, [
      stroke('KeyC', { shift: true }),
      stroke('KeyL', { shift: true }),
      stroke('Digit5'),
      ...altCode('0169'),
      stroke('Enter'),
    ]);
    expect(run.finish()).toEqual({ kind: 'unreadable' });
  });

  test('does not guess when a key cannot be read', () => {
    const run = new ScannerRun();
    press(run, [
      stroke('KeyC', { shift: true }),
      stroke('KeyL', { shift: true }),
      stroke('Digit5'),
      stroke('F5'),
      stroke('Enter'),
    ]);
    expect(run.finish()).toEqual({ kind: 'unreadable' });
  });

  test('starts a new run after a pause', () => {
    const run = new ScannerRun();
    press(run, PINYIN_SCAN);
    run.finish();
    expect(run.keyDown({ ...stroke('KeyA'), at: 9_000 }, 'x')).toBe('pass');
    expect(run.finish()).toEqual({ kind: 'none' });
  });
});
