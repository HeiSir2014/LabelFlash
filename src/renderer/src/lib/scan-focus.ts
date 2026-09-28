import type { Timers } from './timers';

/** 工作台上鼠标和键盘都这么久没动，就把焦点还给扫码框。 */
export const SCAN_FOCUS_IDLE_MS = 10_000;

/**
 * 标了这个属性的区域（例如「手机扫码」浮层）里，焦点落在按钮上也不拉回扫码框：
 * 键盘用户要能在里面按 Tab 切换、按回车操作。扫码枪的字符照样切回扫码框，扫码不受影响。
 */
export const KEEP_FOCUS_ATTRIBUTE = 'data-keep-focus';

/** 焦点所在的元素，只取判断需要的几项（DOM 元素本身就满足这个形状）。 */
export interface FocusTarget {
  tagName: string;
  /** input 的 type；其他元素为空串或 undefined。 */
  type?: string;
  isContentEditable: boolean;
  /** 最近的符合选择器的祖先（含自己）；DOM 元素的 closest。 */
  closest?(selector: string): unknown;
}

/** 不接收文字的 input：开关、按钮、滑块、文件选择等，按键是在操作它们，不是在打字。 */
const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  'checkbox',
  'radio',
  'range',
  'button',
  'submit',
  'reset',
  'image',
  'file',
  'color',
  'hidden',
]);

/**
 * 用户正在往里打字的控件：按键属于它，不当作扫码。
 * 用排除法判断 input，密码、邮箱、网址这类输入框也算；下拉框不算：
 * 下拉框只会把字母当作跳选，扫码内容进去就丢了，还可能悄悄改掉选项。
 */
export function isTypingField(target: FocusTarget | null): boolean {
  if (target === null) {
    return false;
  }
  if (target.tagName === 'INPUT') {
    return !NON_TEXT_INPUT_TYPES.has(target.type ?? '');
  }
  return target.tagName === 'TEXTAREA' || target.isContentEditable;
}

/** 焦点留在这里时不自动拉回扫码框：用户在打字、正在下拉框里选，或者在标了 KEEP_FOCUS_ATTRIBUTE 的区域里操作。 */
export function keepsFocus(target: FocusTarget | null): boolean {
  if (target === null) {
    return false;
  }
  return (
    isTypingField(target) ||
    target.tagName === 'SELECT' ||
    (target.closest?.(`[${KEEP_FOCUS_ATTRIBUTE}]`) ?? null) !== null
  );
}

export interface KeyInfo {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/**
 * 扫码枪「打字」的按键：单个可打印字符，没有 Ctrl / Alt / Meta。
 * 空格除外：焦点在开关、按钮上时，空格是用来操作它们的。
 */
export function isScannerCharacter(event: KeyInfo): boolean {
  return event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.altKey && !event.metaKey;
}

/**
 * 空闲检测：activity() 记录一次操作；最近一次操作之后满 idleMs 没有新操作时调用 onIdle 一次。
 * 鼠标移动很频繁，所以只记时间，不在每次移动时重建计时器。
 */
export class IdleWatcher {
  private timer: number | null = null;
  private lastActivity = 0;

  constructor(
    private readonly idleMs: number,
    private readonly onIdle: () => void,
    private readonly timers: Timers,
    private readonly now: () => number = Date.now,
  ) {}

  activity(): void {
    this.lastActivity = this.now();
    if (this.timer === null) {
      this.schedule(this.idleMs);
    }
  }

  dispose(): void {
    if (this.timer !== null) {
      this.timers.clear(this.timer);
      this.timer = null;
    }
  }

  private schedule(ms: number): void {
    this.timer = this.timers.set(() => this.check(), ms);
  }

  /** 到点时如果期间又有操作，就只补足剩下的时间，不重新从头计时。 */
  private check(): void {
    this.timer = null;
    const idleFor = this.now() - this.lastActivity;
    if (idleFor >= this.idleMs) {
      this.onIdle();
    } else {
      this.schedule(this.idleMs - idleFor);
    }
  }
}
