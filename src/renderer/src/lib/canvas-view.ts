/** 设计器画布的显示和按键：缩放档位、屏幕像素换毫米、按键 → 命令。纯函数，不碰 DOM。 */

/** CSS 像素每毫米（CSS 规定 1in = 96px = 25.4mm）：预览和设计器都按它把毫米换成屏幕上的大小。 */
export const PX_PER_MM = 96 / 25.4;

/** 缩放档位：0.5 倍看全 100×150 的面单，6 倍看清 30×20 小标签上 0.25mm 的线；中间是常用的倍数。 */
export const ZOOM_LEVELS: readonly number[] = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6];

/** 比较档位时容许的误差：「适合窗口」算出来的倍数是任意小数。 */
const ZOOM_EPSILON = 0.001;

/** 放大一档：从当前倍数（可能是「适合窗口」算出的任意值）到下一个更大的档位；已是最大时不变。 */
export function zoomIn(current: number): number {
  return ZOOM_LEVELS.find((level) => level > current + ZOOM_EPSILON) ?? ZOOM_LEVELS.at(-1) ?? current;
}

/** 缩小一档；已是最小时不变。 */
export function zoomOut(current: number): number {
  return [...ZOOM_LEVELS].reverse().find((level) => level < current - ZOOM_EPSILON) ?? ZOOM_LEVELS[0] ?? current;
}

/** 屏幕像素 → 纸上的毫米（在 zoom 倍下）。 */
export function pxToMm(px: number, zoom: number): number {
  return px / (PX_PER_MM * zoom);
}

/** 方向键一次挪 0.1mm（接近 203dpi 的一个打印点 0.125mm），按住 Shift 一次 1mm。 */
export const NUDGE_MM = 0.1;
export const NUDGE_LARGE_MM = 1;

/** 从元素栏拖到画布上时，拖动数据里放元素类型用的格式名（只在这个页面内部用）。 */
export const ELEMENT_DRAG_TYPE = 'application/x-labelflash-element';

export type DesignerCommand =
  | { kind: 'nudge'; dx: number; dy: number }
  | { kind: 'delete' }
  | { kind: 'copy' }
  | { kind: 'paste' }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'deselect' };

/** 按键里判断要用的几项（React 和 DOM 的键盘事件本身就满足这个形状）。 */
export interface DesignerKey {
  key: string;
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
 * 画布上的按键 → 设计器命令。只认方向键、Delete / Backspace、Esc 和 Ctrl（macOS 上 ⌘）组合键；
 * 字母、数字这类可打印字符一律返回 null，不拦：配置中心把它们当作扫码枪的输入送进「预览内容」。
 */
export function designerCommand(event: DesignerKey): DesignerCommand | null {
  if (event.altKey) {
    return null;
  }
  if (event.ctrlKey || event.metaKey) {
    switch (event.key.toLowerCase()) {
      case 'z':
        return event.shiftKey ? { kind: 'redo' } : { kind: 'undo' };
      case 'y':
        return { kind: 'redo' };
      case 'c':
        return { kind: 'copy' };
      case 'v':
        return { kind: 'paste' };
      default:
        return null;
    }
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
