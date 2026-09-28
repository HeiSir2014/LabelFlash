/**
 * ipcMain.handle 抛出的错误只会以 rejection 的形式回到渲染进程，主进程日志里什么也不留：
 * 这里把通道名和原始错误（含主进程堆栈）记下来，再原样抛给调用方。
 */
export function logFailures<A extends unknown[], R>(
  channel: string,
  listener: (...args: A) => R,
  logError: (message: string, error: unknown) => void,
): (...args: A) => Promise<Awaited<R>> {
  return async (...args: A): Promise<Awaited<R>> => {
    try {
      return await listener(...args);
    } catch (error) {
      logError(`[ipc] ${channel} failed`, error);
      throw error;
    }
  };
}
