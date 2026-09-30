/**
 * 把主窗口带到最前并给它焦点（更新后重启、双击桌面快捷方式唤出托盘里的程序、点系统通知）。
 * 不 import electron：窗口由参数传入，用 bun test 测试。
 *
 * Windows 有前台锁：用户刚在别的程序里操作过（例如刚点了「重启更新」、双击了快捷方式）时，
 * 没有前台权限的进程调 show()、focus() 只会让任务栏按钮闪烁，窗口留在后面，扫码框收不到扫码枪的输入。
 * 更新后的新版本由安装程序在后台拉起，正是这种情况。2026-09-30 在 Windows 11 上实测（先让别的进程收到一次按键，
 * 再由没有前台权限的进程启动窗口，用 GetForegroundWindow 核对）：show、show + focus、先置顶再取消都在后面，
 * 先最小化再还原每次都能到前台——系统允许激活从最小化还原出来的窗口。Electron 的 isFocused() 在这种情况下
 * 也会说「有焦点」（它看的是本线程的活动窗口），不能拿它判断，所以不先检查、直接做。
 */
export interface ActivatableWindow {
  isVisible(): boolean;
  isMinimized(): boolean;
  show(): void;
  minimize(): void;
  restore(): void;
  focus(): void;
}

export function bringToFront(window: ActivatableWindow, platform: NodeJS.Platform): void {
  if (platform === 'win32') {
    // 隐藏着（在托盘里）或被挡在后面的都先最小化：还原时才会被系统激活。
    if (!window.isMinimized()) {
      window.minimize();
    }
    window.restore();
    window.focus();
    return;
  }
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
}
