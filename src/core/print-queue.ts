import { PrintError } from './errors';
import { SerialQueue } from './serial-queue';

export type PrintTask<T> = (signal: AbortSignal) => Promise<T>;

/**
 * 每台打印机一个串行队列；不同打印机之间可以并行。超时会中止任务（signal）并以 PRINT_TIMEOUT 失败。
 *
 * 超时后立即让出该打印机的队列位置（超时按已打印处理），不等挂住的驱动调用返回，否则一台卡死的打印机
 * 会永远堵住后续任务。因此适配器必须在 signal 中止时停止工作。
 */
export class PrintQueue {
  private readonly queues = new Map<string, SerialQueue>();

  constructor(private readonly timeoutMs: number) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new RangeError(`Print timeout must be a positive finite number, got ${timeoutMs}`);
    }
  }

  enqueue<T>(printerName: string, task: PrintTask<T>): Promise<T> {
    let queue = this.queues.get(printerName);
    if (!queue) {
      queue = new SerialQueue();
      this.queues.set(printerName, queue);
    }
    return queue.run(() => runWithTimeout(task, this.timeoutMs));
  }
}

function runWithTimeout<T>(task: PrintTask<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new PrintError('PRINT_TIMEOUT'));
    }, timeoutMs);
  });
  // 经 then 调用任务：任务同步抛错也会变成 rejected promise，从而走到 finally 清掉计时器。
  const run = Promise.resolve().then(() => task(controller.signal));
  return Promise.race([run, timeout]).finally(() => clearTimeout(timer));
}
