/** 按提交顺序逐个执行异步任务；前一个任务失败不影响后续任务。 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private count = 0;

  /** 排着的和正在跑的任务数：跑完（成功或失败）就不算。关到托盘后的静默更新靠它判断程序是否空闲。 */
  get pending(): number {
    return this.count;
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    this.count += 1;
    const result = this.tail.then(task).finally(() => {
      this.count -= 1;
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
}
