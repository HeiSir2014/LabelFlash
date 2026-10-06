/** 带着这个参数启动时关闭硬件加速（必须在 app ready 之前生效）。 */
export const SOFTWARE_RENDERING_SWITCH = '--cdl-software-rendering';

export interface ChildProcessExit {
  type: string;
  reason: string;
  exitCode: number;
}

export interface GpuCrashHandlerOptions {
  isSoftwareRendering: boolean;
  /** 重启后要带上的原始命令行参数（不含可执行文件本身）。 */
  args: readonly string[];
  /** 正在退出时不重启，否则关机、托盘「退出」会被变成一次重启。 */
  canRelaunch: () => boolean;
  /** 排一次重启（PendingRelaunch.request）：真正重启要等退出确定发生。 */
  relaunch: (args: string[]) => void;
  quit: () => void;
  warn: (message: string) => void;
}

/**
 * 排着的一次重启：等退出确定要发生时（before-quit 放行的那一刻）才交给 app.relaunch。
 * app.relaunch 一调用就记下了，之后不管哪次退出都会重启：退出确认框（批量打印、没保存的模板）选了「取消」，
 * 程序接着用，下一次操作员自己退出时却又被拉起来。确认框取消时 cancel() 丢掉它。
 */
export class PendingRelaunch {
  private args: string[] | null = null;

  request(args: string[]): void {
    this.args = args;
  }

  cancel(): void {
    this.args = null;
  }

  /** 退出确定要发生时调用：有排着的重启就交给 relaunch，只交一次。 */
  commit(relaunch: (args: string[]) => void): void {
    if (this.args !== null) {
      relaunch(this.args);
      this.args = null;
    }
  }
}

/**
 * GPU 进程挂掉时，界面会白屏或停止刷新，而车间电脑常见老旧集显和远程桌面。
 * 这里只重启一次并改用软件渲染：已经是软件渲染还崩说明不是显卡问题，再重启只会循环。
 * 用 quit 而不是 exit，让数据库照常关闭。
 */
export function createGpuCrashHandler(options: GpuCrashHandlerOptions): (details: ChildProcessExit) => void {
  let isRelaunching = false;
  return (details) => {
    if (
      details.type !== 'GPU' ||
      details.reason === 'clean-exit' ||
      options.isSoftwareRendering ||
      isRelaunching ||
      !options.canRelaunch()
    ) {
      return;
    }
    isRelaunching = true;
    options.warn(`[gpu] GPU process ${details.reason} (exit ${details.exitCode}), restarting with software rendering`);
    options.relaunch([...options.args, SOFTWARE_RENDERING_SWITCH]);
    options.quit();
  };
}
