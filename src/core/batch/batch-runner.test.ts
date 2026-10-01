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
});
