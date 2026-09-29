/**
 * Windows 上扫码框的两种模式（macOS 上扫码框本来就是普通输入框，没有这两种模式）：
 * - scan（默认）：透明密码框，输入法关着，扫码枪的按键不会被截走（见 scan-field.ts）。
 * - manual：操作员用鼠标点进扫码框，换成普通输入框：能用输入法打中文，有真实的光标和选区，能在中间改字。
 * 交出一次内容、按 Esc、焦点离开、一段时间没有操作，都回到扫码模式：扫码台的默认状态必须是「扫得进」。
 * 扫码模式下只有鼠标点击会切换：扫码枪的按键、自动回焦都不能把输入法打开。
 */

export type ScanMode = 'scan' | 'manual';

export type ScanModeEvent = 'pointer-down' | 'submitted' | 'escape' | 'blur' | 'idle';

export function nextScanMode(mode: ScanMode, event: ScanModeEvent): ScanMode {
  if (event === 'pointer-down') {
    return 'manual';
  }
  return mode === 'manual' ? 'scan' : mode;
}

/**
 * 相邻两个按键间隔不超过这么久，像扫码枪：有线扫码枪每个字符一般 5–20 毫秒，无线的慢一些；
 * 打字最快的人偶尔也有这么快的两下，所以还要同时满足「连续好几个」「输入法插了手」「以回车或 Tab 结尾」（见 scanner-keys.ts）。
 */
export const SCANNER_KEY_GAP_MS = 50;
/** 连续这么多个这样的按键（不算 Shift 这类修饰键）才算扫码枪：两三个键偶尔也会按得很快（例如同时按下）。 */
export const SCANNER_BURST_KEYS = 4;
