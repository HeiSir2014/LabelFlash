/**
 * 扫码接收框（工作台扫码框、配置中心的隐藏接收框）用什么输入框，以及框里怎么显示码里的换行。
 *
 * 为什么 Windows 上用密码框：扫码枪是「键盘」，逐个按键打字。系统输入法（例如微软拼音）在中文模式下先截住按键：
 * - 字母进了输入法的拼写窗口，页面收到的是组字（composition），不是字符；
 * - 组字时的数字是「选第几个候选词」，5887 要么被吞掉，要么换成了一个中文词；
 * - 最后的回车用来把拼写上屏，页面收不到回车（keydown 的 key 是 Process），一次扫码永远结束不了。
 * 按一下 Shift 切到英文模式就好，是因为按键不再经过输入法。
 * 网页没有关掉输入法的标准办法（CSS 的 ime-mode 早已废弃，inputmode 只管触屏键盘）；Chromium 只在密码框里关掉输入法，
 * 这是它为密码做的保护，Windows 上已实测：中文模式下密码框收到的按键与英文模式完全一致。
 * 密码框的字一律显示成圆点（浏览器样式里带 !important，改不掉），所以看得见的文字另外画一层，见 ScanBar。
 *
 * macOS 暂时不用：密码框会打开系统的「安全输入」，对扫码枪输出中文的方式有什么影响还没在真机上验证。
 */
import type { Platform } from './app-view';

/** 码里的换行、Tab 显示成的符号：密码框（单行输入框）放不下换行，而且看得见符号才知道这是一个多行的码。 */
export const LINE_BREAK_MARK = '⏎';
export const TAB_MARK = '⇥';

export function toDisplay(content: string): string {
  return content.replaceAll('\n', LINE_BREAK_MARK).replaceAll('\t', TAB_MARK);
}

/** 显示的文字换回内容。码里本来就有 ⏎、⇥ 的话也会被换成换行、Tab：扫码内容里几乎不会出现这两个符号。 */
export function fromDisplay(display: string): string {
  return display.replaceAll(LINE_BREAK_MARK, '\n').replaceAll(TAB_MARK, '\t');
}

/**
 * 粘贴到扫码框：单行输入框自己粘贴会删掉换行，多行的码就变了，所以换行、Tab 换成显示用的符号后插到选区的位置。
 * 从表格复制一格时末尾总带着换行，它不是码的一部分，去掉。
 */
export function pasteInto(display: string, selectionStart: number, selectionEnd: number, pasted: string): string {
  const text = toDisplay(pasted.replaceAll('\r\n', '\n').replaceAll('\r', '\n').replace(/\n+$/, ''));
  return display.slice(0, selectionStart) + text + display.slice(selectionEnd);
}

export type ScanFieldType = 'password' | 'text';

export function scanFieldType(platform: Platform): ScanFieldType {
  return platform === 'mac' ? 'text' : 'password';
}
