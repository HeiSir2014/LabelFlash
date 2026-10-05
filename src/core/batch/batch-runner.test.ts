import { describe, expect, test } from 'bun:test';
import type { PrintResult } from '../types';
import type { BatchLabel } from './batch-model';
import { type BatchProgress, BatchRun } from './batch-runner';

const PRINTED: PrintResult = {
  status: 'printed',
  jobId: 'j',
  scan: { raw: '', ruleId: 'batch', ruleName: '批量打印', fields: [] },
};
const NOT_READY: PrintResult = { status: 'failed', reason: 'PRINTER_NOT_READY' };

function labels(count: number): BatchLabel[] {
  return Array.from({ length: count }, (_, index) => ({ row: index + 1, copy: 1, fields: [], content: `${index}` }));
}

/** 等排在后面的微任务和定时器都跑完。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 每张都等测试放行：pending 里是每张的放行函数，按顺序。 */
function gatedRun(count: number) {
  const printed: number[] = [];
  const pending: ((result: PrintResult) => void)[] = [];
  const changes: BatchProgress[] = [];
  const run = new BatchRun('20261002-143501-a1b2', labels(count), {
    print: (label) =>
      new Promise((resolve) => {
        printed.push(label.row);
        pending.push(resolve);
      }),
    onChange: (progress) => changes.push(progress),
  });
  const release = async (result: PrintResult = PRINTED) => {
    pending.shift()?.(result);
    await settle();
  };
  return { run, printed, changes, release, finished: run.run() };
}

describe('BatchRun', () => {
  test('prints every label in order and ends as done', async () => {
    const { run, printed, release, finished } = gatedRun(3);
    await settle();
    await release();
    await release();
    await release();
    await finished;
    expect(printed).toEqual([1, 2, 3]);
    expect(run.snapshot()).toMatchObject({ state: 'done', total: 3, sent: 3, failed: 0 });
  });

  test('records other failures and keeps going', async () => {
    const { run, release, finished } = gatedRun(2);
    await settle();
    await release({ status: 'failed', reason: 'PRINT_ERROR' });
    await release();
    await finished;
    expect(run.snapshot()).toMatchObject({
      state: 'done',
      sent: 1,
      failed: 1,
      failures: [{ row: 1, copy: 1, reason: 'PRINT_ERROR' }],
    });
  });

  // 已经交给打印队列的那一张收不回来：暂停在它打完之后生效。
  test('pauses after the label in flight and resumes with the next one', async () => {
    const { run, printed, release, finished } = gatedRun(3);
    await settle();
    run.pause();
    await release();
    expect(printed).toEqual([1]);
    expect(run.snapshot()).toMatchObject({ state: 'paused', pauseReason: 'operator', sent: 1 });
    run.resume();
    await settle();
    expect(printed).toEqual([1, 2]);
    await release();
    await release();
    await finished;
    expect(run.snapshot().state).toBe('done');
  });

  test('cancels after the label in flight and prints nothing more', async () => {
    const { run, printed, release, finished } = gatedRun(3);
    await settle();
    run.cancel();
    await release();
    await finished;
    expect(printed).toEqual([1]);
    expect(run.snapshot()).toMatchObject({ state: 'canceled', sent: 1 });
  });

  test('cancels while paused', async () => {
    const { run, release, finished } = gatedRun(3);
    await settle();
    run.pause();
    await release();
    run.cancel();
    await finished;
    expect(run.snapshot()).toMatchObject({ state: 'canceled', sent: 1 });
  });

  // 缺纸时后面的每一张都会失败：停下来等人处理，这一张继续时重打，不记成失败。
  test('pauses itself when the printer cannot print and retries that label on resume', async () => {
    const { run, printed, release, finished } = gatedRun(2);
    await settle();
    await release(NOT_READY);
    expect(run.snapshot()).toMatchObject({ state: 'paused', pauseReason: 'PRINTER_NOT_READY', sent: 0, failed: 0 });
    run.resume();
    await settle();
    expect(printed).toEqual([1, 1]);
    await release();
    await release();
    await finished;
    expect(run.snapshot()).toMatchObject({ state: 'done', sent: 2, failed: 0 });
  });

  test('pauses itself when the paper has no printer', async () => {
    const { run, release } = gatedRun(1);
    await settle();
    await release({ status: 'no-printer', paperKey: '60x40', missingPrinter: null });
    expect(run.snapshot()).toMatchObject({ state: 'paused', pauseReason: 'no-printer' });
  });

  test('counts an unexpected error as a driver error and reports every change', async () => {
    const changes: BatchProgress[] = [];
    const run = new BatchRun('20261002-143501-a1b2', labels(1), {
      print: async () => {
        throw new Error('boom');
      },
      onChange: (progress) => changes.push(progress),
    });
    await run.run();
    expect(run.snapshot()).toMatchObject({ state: 'done', failed: 1, failures: [{ row: 1, reason: 'PRINT_ERROR' }] });
    // 开始一次、这一张打完一次、结束一次。
    expect(changes.map((change) => change.state)).toEqual(['running', 'running', 'done']);
    expect(run.pendingLabels).toBe(0);
  });

  // 批量打印不走识别、不走防重复：duplicate / invalid 理论上不会出现，但万一出现也不能当成「已发送」。
  test('treats any status other than printed as a failure', async () => {
    const { run, release, finished } = gatedRun(1);
    await settle();
    await release({ status: 'duplicate', recent: { state: 'printed', at: 0 }, windowMs: 1_000 });
    await finished;
    expect(run.snapshot()).toMatchObject({
      state: 'done',
      sent: 0,
      failed: 1,
      failures: [{ row: 1, copy: 1, reason: 'PRINT_ERROR' }],
    });
  });

  // macOS 上拔了纸、卡纸不会被识别成打印机问题，每一张都会普普通通地失败：连续 3 张都失败就该停下来，
  // 而不是接着把剩下的都打一遍、刷出一整批失败记录。
  test('pauses after consecutive failures on different labels and retries the one that tripped it', async () => {
    const { run, printed, release, finished } = gatedRun(3);
    const failed: PrintResult = { status: 'failed', reason: 'PRINT_ERROR' };
    await settle();
    await release(failed);
    await settle();
    await release(failed);
    await settle();
    await release(failed);
    expect(printed).toEqual([1, 2, 3]);
    expect(run.snapshot()).toMatchObject({
      state: 'paused',
      pauseReason: 'consecutive-failures',
      sent: 0,
      failed: 2,
      // 最近失败的排在最前面。
      failures: [
        { row: 2, copy: 1, reason: 'PRINT_ERROR' },
        { row: 1, copy: 1, reason: 'PRINT_ERROR' },
      ],
    });
    run.resume();
    await settle();
    expect(printed).toEqual([1, 2, 3, 3]);
    await release();
    await finished;
    expect(run.snapshot()).toMatchObject({ state: 'done', sent: 1, failed: 2 });
  });

  test('does not auto-pause when failures are not consecutive', async () => {
    const { run, release, finished } = gatedRun(5);
    const failed: PrintResult = { status: 'failed', reason: 'PRINT_ERROR' };
    await settle();
    await release(failed);
    await settle();
    await release(failed);
    await settle();
    await release(); // 打成功一张，清零连续失败计数。
    await settle();
    await release(failed);
    await settle();
    await release(failed);
    await finished;
    expect(run.snapshot()).toMatchObject({ state: 'done', sent: 1, failed: 4 });
  });

  test('a second resume while already running does nothing', async () => {
    const { run, printed, release, finished } = gatedRun(2);
    await settle();
    run.pause();
    await release();
    run.resume();
    run.resume();
    await settle();
    expect(printed).toEqual([1, 2]);
    await release();
    await finished;
    expect(run.snapshot().state).toBe('done');
  });

  test('resume does nothing while a label is in flight and the run is not paused', async () => {
    const { run, printed, release, finished } = gatedRun(1);
    await settle();
    run.resume();
    await release();
    await finished;
    expect(printed).toEqual([1]);
    expect(run.snapshot().state).toBe('done');
  });

  test('cancels while auto-paused for a printer problem', async () => {
    const { run, release, finished } = gatedRun(2);
    await settle();
    await release(NOT_READY);
    expect(run.snapshot()).toMatchObject({ state: 'paused', pauseReason: 'PRINTER_NOT_READY' });
    run.cancel();
    await finished;
    expect(run.snapshot()).toMatchObject({ state: 'canceled', sent: 0, failed: 0 });
  });

  test('an empty batch finishes immediately as done', async () => {
    const changes: BatchProgress[] = [];
    const run = new BatchRun('20261002-143501-a1b2', [], {
      print: async () => PRINTED,
      onChange: (progress) => changes.push(progress),
    });
    await run.run();
    expect(run.snapshot()).toMatchObject({ state: 'done', total: 0, sent: 0, failed: 0 });
    expect(changes.map((change) => change.state)).toEqual(['running', 'done']);
  });

  test('running it a second time rejects instead of starting a second loop', async () => {
    const { run, release, finished } = gatedRun(1);
    await settle();
    await expect(run.run()).rejects.toThrow();
    await release();
    await finished;
  });

  // onChange 是界面层的回调：它抛错不能打断批量打印本身。
  test('keeps running even if onChange throws', async () => {
    const printedRows: number[] = [];
    const run = new BatchRun('20261002-143501-a1b2', labels(2), {
      print: async (label) => {
        printedRows.push(label.row);
        return PRINTED;
      },
      onChange: () => {
        throw new Error('ui crashed');
      },
    });
    await run.run();
    expect(printedRows).toEqual([1, 2]);
    expect(run.snapshot()).toMatchObject({ state: 'done', sent: 2, failed: 0 });
  });

  // cancel() 让 isActive 立刻变 false 太早：正在打的这一张还没真正打完，调用方可能还需要等它。
  test('isActive and pendingLabels still see the in-flight label right after cancel', async () => {
    const { run, release, finished } = gatedRun(2);
    await settle();
    run.cancel();
    expect(run.isActive).toBe(true);
    expect(run.pendingLabels).toBe(1);
    await release();
    await finished;
    expect(run.isActive).toBe(false);
    expect(run.pendingLabels).toBe(0);
  });

  // 超时不代表没打印（驱动只是没回话）：触发自动暂停的那一张如果是超时，重打有重复出纸的风险，
  // 按失败记下、前进到下一张，暂停原因单独标出来，界面要用不同的措辞提醒操作员自己确认有没有出纸。
  test('does not retry the label that tripped the pause when it timed out, and says so in the pause reason', async () => {
    const { run, printed, release, finished } = gatedRun(5);
    const timeout: PrintResult = { status: 'failed', reason: 'PRINT_TIMEOUT' };
    await settle();
    await release(timeout);
    await settle();
    await release(timeout);
    await settle();
    await release(timeout);
    expect(printed).toEqual([1, 2, 3]); // 没有重打第 3 张
    expect(run.snapshot()).toMatchObject({
      state: 'paused',
      pauseReason: 'consecutive-failures-after-timeout',
      sent: 0,
      failed: 3,
      // 最近失败的排在最前面。
      failures: [
        { row: 3, copy: 1, reason: 'PRINT_TIMEOUT' },
        { row: 2, copy: 1, reason: 'PRINT_TIMEOUT' },
        { row: 1, copy: 1, reason: 'PRINT_TIMEOUT' },
      ],
    });
    run.resume();
    await settle();
    expect(printed).toEqual([1, 2, 3, 4]); // 第 4 张是新的一张，不是重打
    await release();
    await release();
    await finished;
    expect(run.snapshot()).toMatchObject({ state: 'done', sent: 2, failed: 3 });
  });
});

describe('BatchRun.failedLabels', () => {
  test('is empty for a run with no failures', async () => {
    const run = new BatchRun('20261002-143501-a1b2', labels(2), {
      print: async () => PRINTED,
      onChange: () => undefined,
    });
    await run.run();
    expect(run.failedLabels(null)).toEqual([]);
  });

  // 最近失败的排在最前面：行 3 比行 1 后失败，所以排在它前面。
  test('finds the original labels of failed rows and copies, optionally for one row', async () => {
    const { run, release, finished } = gatedRun(3);
    await settle();
    await release({ status: 'failed', reason: 'PRINT_ERROR' });
    await settle();
    await release();
    await settle();
    await release({ status: 'failed', reason: 'PRINT_TIMEOUT' });
    await finished;
    expect(run.failedLabels(null).map((label) => label.row)).toEqual([3, 1]);
    expect(run.failedLabels(3).map((label) => label.row)).toEqual([3]);
    expect(run.failedLabels(2)).toEqual([]);
  });
});

describe('BatchRun.failedReasons', () => {
  test('gives the same rows as failedLabels, with their reason, most recent first', async () => {
    const { run, release, finished } = gatedRun(3);
    await settle();
    await release({ status: 'failed', reason: 'PRINT_ERROR' });
    await settle();
    await release();
    await settle();
    await release({ status: 'failed', reason: 'PRINT_TIMEOUT' });
    await finished;
    expect(run.failedReasons(null)).toEqual([
      { row: 3, copy: 1, reason: 'PRINT_TIMEOUT' },
      { row: 1, copy: 1, reason: 'PRINT_ERROR' },
    ]);
    expect(run.failedReasons(1)).toEqual([{ row: 1, copy: 1, reason: 'PRINT_ERROR' }]);
  });
});

describe('BatchRun.unattemptedLabels', () => {
  test('is empty once the run is done', async () => {
    const run = new BatchRun('20261002-143501-a1b2', labels(2), {
      print: async () => PRINTED,
      onChange: () => undefined,
    });
    await run.run();
    expect(run.unattemptedLabels()).toEqual([]);
  });

  // 退出时正在打的那一张已经交出去了（可能已经出纸），不算「没打过」；它之后的才是确定没打的。
  test('excludes the label in flight and everything already sent, but not the ones after it', async () => {
    const { run, release, finished } = gatedRun(4);
    await settle();
    expect(run.unattemptedLabels().map((label) => label.row)).toEqual([2, 3, 4]);
    run.cancel();
    expect(run.unattemptedLabels().map((label) => label.row)).toEqual([2, 3, 4]);
    await release();
    await finished;
    expect(run.unattemptedLabels().map((label) => label.row)).toEqual([2, 3, 4]);
  });

  // 暂停生效之后（上一张已经交出去、这一张还没交）：剩下的才是确定没打过的。
  test('reflects exactly what has not been sent yet, even while paused', async () => {
    const { run, release } = gatedRun(2);
    await settle();
    run.pause();
    await release();
    expect(run.unattemptedLabels().map((label) => label.row)).toEqual([2]);
  });
});
