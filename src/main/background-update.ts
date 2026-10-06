/**
 * 关到托盘后什么时候可以静默更新：新版本下载好了、窗口关在托盘里有一会儿了、没有在用。
 * 「在用」是：还有标签在排队或在打（桌面扫码、手机扫码、本机接口都走同一个打印队列，本机接口还有自己的任务队列），
 * 或者手机扫码开着（重启会结束会话，所有手机都得重新扫电脑上的二维码），或者模板页有没保存的修改。不 import electron，用 bun test 测试。
 */

/** 窗口关到托盘多久之后才更新：刚关的可能马上又打开，重启的那十几秒里窗口叫不出来。 */
export const HIDDEN_BEFORE_UPDATE_MS = 60_000;
/** 多久看一次条件：条件变化不频繁，半分钟足够及时，也不费电。 */
export const BACKGROUND_UPDATE_CHECK_MS = 30_000;

export interface BackgroundUpdateState {
  isUpdateReady: boolean;
  /** 窗口什么时候关到托盘的；开着时为 null。 */
  hiddenSince: number | null;
  pendingPrints: number;
  isMobileOn: boolean;
  /** 模板页有没保存的修改：静默更新由安装程序直接结束本程序，退出时的确认来不及弹，修改会悄悄丢掉。 */
  hasUnsavedTemplate: boolean;
  now: number;
}

export function canUpdateInBackground(state: BackgroundUpdateState): boolean {
  return (
    state.isUpdateReady &&
    state.hiddenSince !== null &&
    state.now - state.hiddenSince >= HIDDEN_BEFORE_UPDATE_MS &&
    state.pendingPrints === 0 &&
    !state.isMobileOn &&
    !state.hasUnsavedTemplate
  );
}
