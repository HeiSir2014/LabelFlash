/** 设计器画布的显示和按键：缩放档位、屏幕像素换毫米、按键 → 命令。纯函数，不碰 DOM。 */
import type { Platform } from './app-view';

/** CSS 像素每毫米（CSS 规定 1in = 96px = 25.4mm）：预览和设计器都按它把毫米换成屏幕上的大小。 */
export const PX_PER_MM = 96 / 25.4;

/** 缩放档位：0.5 倍看全 100×150 的面单，6 倍看清 30×20 小标签上 0.25mm 的线；中间是常用的倍数。 */
export const ZOOM_LEVELS: readonly number[] = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6];

/** 比较档位时容许的误差：「适合窗口」算出来的倍数是任意小数。 */
const ZOOM_EPSILON = 0.001;

/**
 * 放大一档：从当前倍数（可能是「适合窗口」算出的任意值）到下一个更大的档位。
 * 比最小档还小时跳到最小档（仍是朝「放大」方向，不算反向）；比最大档还大时没有更大的可去，
 * 原样不动——不能收口到更小的最大档，那样反而变小，和「放大」的方向反了。
 */
export function zoomIn(current: number): number {
  const min = ZOOM_LEVELS[0] ?? current;
  const max = ZOOM_LEVELS.at(-1) ?? current;
  if (current > max + ZOOM_EPSILON) {
    return current;
  }
  if (current >= max - ZOOM_EPSILON) {
    return max;
  }
  if (current < min - ZOOM_EPSILON) {
    return min;
  }
  return ZOOM_LEVELS.find((level) => level > current + ZOOM_EPSILON) ?? max;
}

/**
 * 缩小一档：比最大档还大时收口到最大档（仍是朝「缩小」方向）；比最小档还小时没有更小的可去，
 * 原样不动——不能收口到更大的最小档，那样反而变大，和「缩小」的方向反了。
 */
export function zoomOut(current: number): number {
  const min = ZOOM_LEVELS[0] ?? current;
  const max = ZOOM_LEVELS.at(-1) ?? current;
  if (current < min - ZOOM_EPSILON) {
    return current;
  }
  if (current <= min + ZOOM_EPSILON) {
    return min;
  }
  if (current > max + ZOOM_EPSILON) {
    return max;
  }
  return [...ZOOM_LEVELS].reverse().find((level) => level < current - ZOOM_EPSILON) ?? min;
}

/**
 * Ctrl+滚轮、触控板捏合的缩放速度：deltaY 每 1 个单位放大或缩小 0.2%。鼠标滚轮一格约 100，约 1.2 倍；
 * 捏合一次只发几个单位，缩放连续、跟手（Chromium 把捏合发成带 ctrlKey 的 wheel）。
 */
export const WHEEL_ZOOM_PER_DELTA = 0.002;
/** 缩放倍数只留三位小数：百分比显示到个位，再细的小数只会让布局抖。 */
const ZOOM_PRECISION = 1000;

/** 滚轮、捏合之后的倍数：连续变化，收在最小档和最大档之间。 */
export function wheelZoom(current: number, deltaY: number): number {
  const min = ZOOM_LEVELS[0] ?? current;
  const max = ZOOM_LEVELS.at(-1) ?? current;
  const next = current * Math.exp(-deltaY * WHEEL_ZOOM_PER_DELTA);
  return Math.round(Math.min(max, Math.max(min, next)) * ZOOM_PRECISION) / ZOOM_PRECISION;
}

/**
 * 以指针为中心缩放：缩放前记下指针下面是纸上哪一点（anchor，mm），缩放后覆盖层左上角到了 origin（窗口坐标），
 * 这一点跑到了 origin + anchor × 新倍数；画布要滚动这么多，它才回到指针下面。
 */
export function scrollToKeep(
  anchor: { x: number; y: number },
  pointer: { x: number; y: number },
  origin: { x: number; y: number },
  zoom: number,
): { x: number; y: number } {
  const pxPerMm = PX_PER_MM * zoom;
  return { x: origin.x + anchor.x * pxPerMm - pointer.x, y: origin.y + anchor.y * pxPerMm - pointer.y };
}

/** 屏幕像素 → 纸上的毫米（在 zoom 倍下）。 */
export function pxToMm(px: number, zoom: number): number {
  return px / (PX_PER_MM * zoom);
}

/** 方向键一次挪 0.1mm：接近 203dpi 的一个打印点（0.125mm），够精细地微调位置。 */
export const NUDGE_MM = 0.1;
/** 按住 Shift 时，方向键一次挪 1mm：需要粗调位置时不用按几十次。 */
export const NUDGE_LARGE_MM = 1;

/** 元素 id 的规则（和 core 的 sanitize-canvas 一致）：只有字母、数字、连字符，放进 CSS 选择器不用转义。 */
const ELEMENT_ID_PATTERN = /^[A-Za-z0-9-]+$/;

/**
 * 「隐藏（只在设计器里隐藏）」：画布上的标签是打印同一份 HTML，每个元素带着 data-element-id；
 * 在 head 末尾加一段样式把这些元素藏起来（sandbox 的 iframe 不跑脚本，样式照样生效）。打印不经过这里。
 * 不合元素 id 规则的值直接跳过：不能让它拼出别的选择器。
 */
export function hideElementsInHtml(html: string, hidden: ReadonlySet<string>): string {
  const selectors = [...hidden].filter((id) => ELEMENT_ID_PATTERN.test(id)).map((id) => `[data-element-id="${id}"]`);
  return selectors.length === 0
    ? html
    : html.replace('</head>', `<style>${selectors.join(',')}{visibility:hidden}</style></head>`);
}

/**
 * 点了设计器里的按钮（浮动工具条、检查器、元素栏……）之后，要不要把焦点还给画布。
 * 设计器的快捷键（Ctrl+Z、方向键、Delete）挂在画布上：焦点留在按钮上，这些键就不起作用了。
 * focus：操作做完那一刻焦点在哪——clicked = 还在点的按钮上，body = 掉到了页面上（按钮随操作没了，比如删除），
 * elsewhere = 操作自己把焦点交给了别处（就地改字的输入框、菜单），那里接着用，不抢。
 * 用键盘按的（Tab 走到工具条、按空格）焦点留在按钮上，方便接着用键盘走工具条。
 */
export function shouldReturnFocusToCanvas(click: {
  isPointerClick: boolean;
  focus: 'clicked' | 'body' | 'elsewhere';
}): boolean {
  return click.focus === 'body' || (click.isPointerClick && click.focus === 'clicked');
}

/** 从元素栏拖到画布上时，拖动数据里放元素类型用的格式名（只在这个页面内部用）。 */
export const ELEMENT_DRAG_TYPE = 'application/x-labelflash-element';

/** 画布覆盖层 aria-label 里的撤销快捷键文字：和配置中心的快捷键提示（`configShortcutLabel`）用同一套平台判断。 */
export function undoShortcutLabel(platform: Platform): string {
  return platform === 'mac' ? '⌘Z' : 'Ctrl+Z';
}

/** 画布上的按键解析出的命令：视图模型据此改选区、历史或模板，具体怎么改不在这里管。 */
export type DesignerCommand =
  | { kind: 'nudge'; dx: number; dy: number }
  | { kind: 'delete' }
  | { kind: 'copy' }
  | { kind: 'paste' }
  | { kind: 'duplicate' }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'deselect' }
  | { kind: 'selectAll' }
  | { kind: 'layer'; move: LayerMove }
  | { kind: 'zoom'; to: 'fit' | 'actual' }
  | { kind: 'help' }
  | { kind: 'menu' };

/** 叠放：上移一层、下移一层、置顶、置底。 */
export type LayerMove = 'forward' | 'backward' | 'front' | 'back';

/** 按键里判断要用的几项（React 和 DOM 的键盘事件本身就满足这个形状）。 */
export interface DesignerKey {
  key: string;
  /**
   * 物理键位（`KeyboardEvent.code`），不受输入法和键盘布局影响，例如俄语键盘上的「KeyZ」。
   * Ctrl 组合键认不出 `key`（非拉丁字符）时拿它兜底；可选是因为测试和部分调用点不传也能工作。
   */
  code?: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * Ctrl 组合键的物理键位 → 对应的字母：只在 `key` 不是拉丁字母时才用它兜底（例如俄语、希腊语键盘，
 * `key` 是当前布局的字符，不是 z/y/c/v）。拉丁字母键盘（德语 QWERTZ、法语 AZERTY……）的物理键位
 * 和字母对不上——QWERTZ 上 Ctrl+Z 的物理键位是 KeyY、AZERTY 上 Ctrl+W 的物理键位是 KeyZ——
 * 这些布局下 `key` 本身已经是正确的字母，绝不能被 `code` 覆盖掉。
 */
const CTRL_SHORTCUT_CODES: Readonly<Record<string, string>> = {
  KeyZ: 'z',
  KeyY: 'y',
  KeyC: 'c',
  KeyV: 'v',
  KeyA: 'a',
  KeyD: 'd',
};

/**
 * 不随布局、Shift 变的组合键按物理键位认：Ctrl+Shift+] 的 key 是「}」，Ctrl+0 在法语键盘上的 key 是「à」。
 * 这几个键不是字母，没有上面那种「拉丁布局里键位和字母对不上」的问题。
 */
const CTRL_CODE_COMMANDS: Readonly<Record<string, (shift: boolean) => DesignerCommand>> = {
  BracketRight: (shift) => ({ kind: 'layer', move: shift ? 'front' : 'forward' }),
  BracketLeft: (shift) => ({ kind: 'layer', move: shift ? 'back' : 'backward' }),
  Digit0: () => ({ kind: 'zoom', to: 'fit' }),
  Numpad0: () => ({ kind: 'zoom', to: 'fit' }),
  Digit1: () => ({ kind: 'zoom', to: 'actual' }),
  Numpad1: () => ({ kind: 'zoom', to: 'actual' }),
};

/** 测试或调用方没给 code 时按 key 兜底（美式键盘上的字符）。 */
const CTRL_KEY_CODES: Readonly<Record<string, string>> = {
  ']': 'BracketRight',
  '}': 'BracketRight',
  '[': 'BracketLeft',
  '{': 'BracketLeft',
  '0': 'Digit0',
  '1': 'Digit1',
};

/** 拉丁小写字母：`key` 落在这个范围内时就是可信的，不需要再查 `code`。 */
const LATIN_LETTER = /^[a-z]$/;

/**
 * 画布上的按键 → 设计器命令。只认方向键、Delete / Backspace、Esc、F1 和 Ctrl（macOS 上 ⌘）组合键；
 * 字母、数字这类可打印字符一律返回 null，不拦：配置中心把它们当作扫码枪的输入送进「预览内容」。
 * AltGr（在不少非美式键盘上用来打特殊符号）在浏览器里等同 Ctrl+Alt：altKey 一起按下时一律放行，
 * 不然这些键盘上打字会被当成撤销、复制一类的快捷键。
 */
export function designerCommand(event: DesignerKey): DesignerCommand | null {
  if (event.altKey) {
    return null;
  }
  if (event.ctrlKey || event.metaKey) {
    const byCode = CTRL_CODE_COMMANDS[event.code || (CTRL_KEY_CODES[event.key] ?? '')];
    if (byCode) {
      return byCode(event.shiftKey);
    }
    const letter = event.key.toLowerCase();
    const name = LATIN_LETTER.test(letter) ? letter : (CTRL_SHORTCUT_CODES[event.code ?? ''] ?? letter);
    switch (name) {
      case 'z':
        return event.shiftKey ? { kind: 'redo' } : { kind: 'undo' };
      case 'y':
        return { kind: 'redo' };
      case 'c':
        return { kind: 'copy' };
      case 'v':
        return { kind: 'paste' };
      case 'd':
        return { kind: 'duplicate' };
      case 'a':
        return { kind: 'selectAll' };
      default:
        return null;
    }
  }
  // F1 不是可打印字符，扫码枪不会发出它。
  if (event.key === 'F1') {
    return { kind: 'help' };
  }
  // 菜单键、Shift+F10：用键盘打开右键菜单（Windows 的通行做法）。
  if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
    return { kind: 'menu' };
  }
  const arrow = ARROWS[event.key];
  if (arrow) {
    const step = event.shiftKey ? NUDGE_LARGE_MM : NUDGE_MM;
    return { kind: 'nudge', dx: arrow[0] * step, dy: arrow[1] * step };
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    return { kind: 'delete' };
  }
  if (event.key === 'Escape') {
    return { kind: 'deselect' };
  }
  return null;
}
