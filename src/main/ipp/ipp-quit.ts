/**
 * 退出程序、重启更新时局域网共享还有没打完的任务：确认框的文字、拒绝更新的说明、停共享时最多等多久。
 * 和 pdf/pdf-quit.ts 同一套做法；不依赖 Electron（对话框、app.quit 在 src/main/index.ts 里调用），方便单测。
 */

/** 退出前停共享（告别广播、等正在回的请求）最多等这么久：不能让退出程序跟着卡住。 */
export const IPP_STOP_ON_QUIT_TIMEOUT_MS = 3_000;

/** 点「重启更新」时还有共享的任务：和批量打印一样直接拒绝（quitAndInstall 不给弹确认的机会）。 */
export const IPP_BLOCKS_UPDATE_ISSUE = '局域网共享还有任务没打完：等它们打完（或在共享页处理等确认的电脑）再重启更新';

/** 还有共享的任务就不能「重启更新」；返回拒绝的说明，没有就是 null。 */
export function ippBlocksUpdate(pendingJobs: number): string | null {
  return pendingJobs > 0 ? IPP_BLOCKS_UPDATE_ISSUE : null;
}

/** 退出确认框的文字：只说程序确知的事——这些任务是别的电脑交来的，还没全部交给打印机。 */
export function ippQuitDialogText(pendingJobs: number): { message: string; detail: string } {
  return {
    message: `局域网共享还有 ${pendingJobs} 个任务没打完，现在退出吗？`,
    detail:
      '这些任务是局域网里别的电脑交来的。选「仍要退出」后没打的部分不会再打，对方电脑的打印队列会显示任务中止，需要在那台电脑上重新打印。',
  };
}

/** 等 work 结束（成功失败都算），最多等 timeoutMs；按时结束返回 true。 */
export function settleWithin(work: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    work.then(
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      () => {
        clearTimeout(timer);
        resolve(true);
      },
    );
  });
}
