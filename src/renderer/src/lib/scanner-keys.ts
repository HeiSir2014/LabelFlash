/**
 * 输入法截住扫码枪按键时，按物理按键把扫码内容拼回来（纯逻辑，bun test 测试）。
 *
 * 中文输入法在中文模式下截住按键：keydown 的 key 是 Process，页面收到的是输入法组出来的字——
 * 数字被吞掉或选了候选词（「CL5887-M」变成「CL-M」，「cl5」变成「错了」），回车只用来上屏。
 * 但每个 keydown 的 code（物理按键）、Shift、Caps Lock 照样准确（Windows + 微软拼音实测）。
 * 扫码枪模拟的是美式键盘，所以按 code 和 Shift 就能拼出它实际发出的字符，输入法组出来的字整个丢掉。
 *
 * 扫码枪输出中文不经过输入法，而是 Alt+小键盘码（见 altCodeChar）：输入法开着时它照样会弄乱这个字，所以 Alt 码也按键拼回来。
 * 只在三个条件同时成立时接管：按键快得像扫码枪、输入法插了手（出现 Process）、以回车或 Tab 结尾。
 * 人打拼音慢得多；很快但没有结尾键的一串不自动提交。拼不出来的键（功能键、不成字的 Alt 码）不去猜。
 */
import { SCANNER_BURST_KEYS, SCANNER_KEY_GAP_MS } from './scan-mode';

export interface KeyStroke {
  code: string;
  key: string;
  shift: boolean;
  caps: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  /** 按下的时间（毫秒）。 */
  at: number;
}

/** 美式键盘上的符号键：[不按 Shift, 按 Shift]。 */
const SYMBOL_KEYS: Readonly<Record<string, readonly [string, string]>> = {
  Minus: ['-', '_'],
  Equal: ['=', '+'],
  BracketLeft: ['[', '{'],
  BracketRight: [']', '}'],
  Backslash: ['\\', '|'],
  Semicolon: [';', ':'],
  Quote: ["'", '"'],
  Comma: [',', '<'],
  Period: ['.', '>'],
  Slash: ['/', '?'],
  Backquote: ['`', '~'],
  Space: [' ', ' '],
};

const SHIFTED_DIGITS = ')!@#$%^&*(';

const NUMPAD_KEYS: Readonly<Record<string, string>> = {
  NumpadDecimal: '.',
  NumpadAdd: '+',
  NumpadSubtract: '-',
  NumpadMultiply: '*',
  NumpadDivide: '/',
};

const MODIFIER_CODES: ReadonlySet<string> = new Set([
  'ShiftLeft',
  'ShiftRight',
  'CapsLock',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

/** 回车、Tab 是码里的分隔（码中间）或扫码结束（最后一个）。 */
const BREAK_KEYS: Readonly<Record<string, string>> = { Enter: '\n', NumpadEnter: '\n', Tab: '\t' };

/** 物理按键对应的字符：修饰键本身是空串；拼不出来的（带 Alt / Ctrl / Meta、功能键）是 null。 */
export function charForKey(stroke: Omit<KeyStroke, 'at'>): string | null {
  const { code, shift, caps } = stroke;
  if (MODIFIER_CODES.has(code)) {
    return '';
  }
  if (stroke.alt || stroke.ctrl || stroke.meta) {
    return null;
  }
  const breakChar = BREAK_KEYS[code];
  if (breakChar !== undefined) {
    return breakChar;
  }
  if (/^Key[A-Z]$/.test(code)) {
    const letter = code.slice(3);
    return shift !== caps ? letter : letter.toLowerCase();
  }
  if (/^Digit\d$/.test(code)) {
    const digit = Number(code.slice(5));
    return shift ? (SHIFTED_DIGITS[digit] ?? null) : String(digit);
  }
  if (/^Numpad\d$/.test(code)) {
    return code.slice(6);
  }
  const numpad = NUMPAD_KEYS[code];
  if (numpad !== undefined) {
    return numpad;
  }
  const symbol = SYMBOL_KEYS[code];
  return symbol ? symbol[shift ? 1 : 0] : null;
}

const ASCII_LIMIT = 128;
const BYTE = 256;
const MAX_ALT_CODE = 0xffff;
/** GB18030 是 GBK 的超集，和扫码页识别中文码时用的解码一致。 */
const GBK = new TextDecoder('gb18030', { fatal: true });

/**
 * 扫码枪输出中文的方式：按住 Alt，在小键盘上敲这个字在系统代码页里的十进制编码，松开 Alt 由 Windows 换成字。
 * 中文 Windows 的代码页是 936（GBK），一个汉字两个字节：「灰」= 0xBBD2 = 48082。
 * 128 以下是 ASCII；128–255 是半个 GBK 字，拼不成一个字（例如西文代码页的「Alt+0169」），不去猜。
 */
export function altCodeChar(digits: string): string | null {
  const code = Number(digits);
  if (digits === '' || !Number.isInteger(code) || code <= 0 || code > MAX_ALT_CODE) {
    return null;
  }
  if (code < ASCII_LIMIT) {
    return String.fromCharCode(code);
  }
  if (code < BYTE) {
    return null;
  }
  try {
    return GBK.decode(new Uint8Array([Math.floor(code / BYTE), code % BYTE]));
  } catch {
    return null;
  }
}

const ALT_CODES: ReadonlySet<string> = new Set(['AltLeft', 'AltRight']);

/** 按物理按键拼出这一串的内容；有拼不出来的键时返回 null。按住 Alt 时小键盘上的数字是一个 Alt 码。 */
function rebuild(strokes: readonly KeyStroke[]): string | null {
  let text = '';
  let altDigits: string | null = null;
  const closeAltCode = (): boolean => {
    if (altDigits === null) {
      return true;
    }
    const char = altCodeChar(altDigits);
    altDigits = null;
    if (char === null) {
      return false;
    }
    text += char;
    return true;
  };
  for (const item of strokes) {
    if (ALT_CODES.has(item.code)) {
      if (!closeAltCode()) {
        return null;
      }
      altDigits = '';
      continue;
    }
    if (altDigits !== null && item.alt && /^Numpad\d$/.test(item.code)) {
      altDigits += item.code.slice(6);
      continue;
    }
    if (!closeAltCode()) {
      return null;
    }
    const char = charForKey(item);
    if (char === null) {
      return null;
    }
    text += char;
  }
  return closeAltCode() ? text : null;
}

/** keyDown 的结果：capture = 这一串已由这里接管，调用方要拦下这个键（不交给输入框和扫码拼接）。 */
export type RunDecision = 'pass' | 'capture';

export type RunResult =
  | { kind: 'none' }
  /** 拼出来的扫码内容（不含结尾的回车 / Tab），接在这一串开始前框里已有的内容后面。 */
  | { kind: 'rebuilt'; text: string; contentBefore: string }
  /** 像扫码枪、输入法也插了手，但拼不出来或没有结尾键：不提交，提醒操作员。 */
  | { kind: 'unreadable' };

export class ScannerRun {
  private strokes: KeyStroke[] = [];
  private lastAt: number | null = null;
  private contentBefore = '';
  private isCapturing = false;

  /** 记下一次按键。content 是按下这个键之前框里的内容：新的一串从这里开始时记下它。 */
  keyDown(stroke: KeyStroke, content: string): RunDecision {
    const isFast = this.lastAt !== null && stroke.at - this.lastAt <= SCANNER_KEY_GAP_MS;
    if (!isFast) {
      this.strokes = [];
      this.contentBefore = content;
      this.isCapturing = false;
    }
    this.lastAt = stroke.at;
    this.strokes.push(stroke);
    if (!this.isCapturing) {
      const sawInputMethod = this.strokes.some((item) => item.key === 'Process');
      const keys = this.strokes.filter((item) => !MODIFIER_CODES.has(item.code)).length;
      this.isCapturing = sawInputMethod && keys >= SCANNER_BURST_KEYS;
    }
    return this.isCapturing ? 'capture' : 'pass';
  }

  /** 按键停下来之后调用：给出这一串的结果，并开始新的一串。 */
  finish(): RunResult {
    const { strokes, contentBefore, isCapturing } = this;
    this.strokes = [];
    this.lastAt = null;
    this.isCapturing = false;
    if (!isCapturing) {
      return { kind: 'none' };
    }
    const text = rebuild(strokes);
    if (text === null) {
      return { kind: 'unreadable' };
    }
    const last = text.at(-1);
    if (last !== '\n' && last !== '\t') {
      return { kind: 'unreadable' };
    }
    return { kind: 'rebuilt', text: text.slice(0, -1), contentBefore };
  }
}
