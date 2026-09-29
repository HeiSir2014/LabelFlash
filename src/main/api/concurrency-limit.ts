import { ApiError } from './api-error';

/**
 * 同时最多跑 maxRunning 个任务，再多的最多排 maxQueued 个，排满了直接拒绝。
 * 给只排版（PDF）用：每次都开一个隐藏窗口（一个渲染进程），不限的话一次突发请求就能开出几十个，和打印抢资源。
 */
export class ConcurrencyLimit {
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly maxRunning: number,
    private readonly maxQueued: number,
  ) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.maxRunning) {
      if (this.waiting.length >= this.maxQueued) {
        throw new ApiError('RESOURCE_EXHAUSTED', 'RENDER_BUSY', '正在生成的 PDF 太多：请稍后再试');
      }
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.running += 1;
    }
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) {
        // 名额直接交给排队的下一个，running 不变。
        next();
      } else {
        this.running -= 1;
      }
    }
  }
}
