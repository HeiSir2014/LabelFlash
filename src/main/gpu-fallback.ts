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
  relaunch: (args: string[]) => void;
  quit: () => void;
  warn: (message: string) => void;
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
