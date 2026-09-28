import { PrintError } from './errors';
import { SerialQueue } from './serial-queue';

export type PrintTask<T> = (signal: AbortSignal) => Promise<T>;

/** 每台打印机一个串行队列；不同打印机之间可以并行。超时会中止任务（signal）并以 PRINT_TIMEOUT 失败。 */
export class PrintQueue {
  private readonly queues = new Map<string, SerialQueue>();

  constructor(private readonly timeoutMs: number) {}

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
  return Promise.race([task(controller.signal), timeout]).finally(() => clearTimeout(timer));
}
