import { describe, expect, test } from 'bun:test';
import { templateFingerprint } from '../../core/api/template-fields';
import { CANVAS_TAG } from '../../core/templates/builtin-canvas';
import { batchQuitDialogText, canceledJobRecords, shouldConfirmBatchQuit, waitForBatchIdle } from './batch-quit';

describe('shouldConfirmBatchQuit', () => {
  test('confirms when labels are still pending', () => {
    expect(shouldConfirmBatchQuit(3, false)).toBe(true);
  });

  test('skips when nothing is pending', () => {
    expect(shouldConfirmBatchQuit(0, false)).toBe(false);
  });

  test('skips during an OS shutdown even with labels pending', () => {
    expect(shouldConfirmBatchQuit(3, true)).toBe(false);
  });
});

describe('batchQuitDialogText', () => {
  test('mentions the count and says the labels were never sent to the printer', () => {
    const { message, detail } = batchQuitDialogText(5);
    expect(message).toContain('5');
    expect(detail).toContain('还没交给打印机');
  });

  // 用打印记录里的措辞（见 status-text.ts 的 FAILURE_SHORT），同一件事说法一致。
  test('uses the same wording as the job log (退出时未打)', () => {
    expect(batchQuitDialogText(1).detail).toContain('退出时未打');
  });

  // 重启之后批量打印页看不到这一批（内存里的状态已经没了）：不能说「去批量打印页重打」，
  // 要指到真的能找到它的地方——打印记录按批次筛选。
  test('points to the job log filter, not the batch page, since it will not remember this batch after a restart', () => {
    const { detail } = batchQuitDialogText(1);
    expect(detail).toContain('打印记录');
    expect(detail).not.toContain('批量打印页');
  });
});

describe('canceledJobRecords', () => {
  test('records one CANCELED job per unattempted label with the batch, row and copy', () => {
    const labels = [
      { row: 3, copy: 1, fields: [], content: 'a' },
      { row: 7, copy: 2, fields: [], content: 'b' },
    ];
    let nextId = 0;
    const records = canceledJobRecords(
      '20261002-143501-a1b2',
      CANVAS_TAG,
      labels,
      () => `id-${++nextId}`,
      () => 1000,
    );
    expect(records).toEqual([
      {
        id: 'id-1',
        createdAt: 1000,
        raw: 'a',
        printerName: '',
        source: 'batch',
        status: 'failed',
        forced: false,
        failureReason: 'CANCELED',
        paper: expect.any(String),
        templateId: CANVAS_TAG.id,
        templateFingerprint: templateFingerprint(CANVAS_TAG),
        fields: [],
        batch: { id: '20261002-143501-a1b2', row: 3, copy: 1 },
      },
      {
        id: 'id-2',
        createdAt: 1000,
        raw: 'b',
        printerName: '',
        source: 'batch',
        status: 'failed',
        forced: false,
        failureReason: 'CANCELED',
        paper: expect.any(String),
        templateId: CANVAS_TAG.id,
        templateFingerprint: templateFingerprint(CANVAS_TAG),
        fields: [],
        batch: { id: '20261002-143501-a1b2', row: 7, copy: 2 },
      },
    ]);
  });
});

describe('waitForBatchIdle', () => {
  test('resolves once the batch is idle', async () => {
    await waitForBatchIdle(() => Promise.resolve(), 1_000);
  });

  // 驱动调用真的卡住时，退出流程不能跟着永远卡住。
  test('gives up after the timeout when idle never resolves', async () => {
    const started = performance.now();
    await waitForBatchIdle(() => new Promise(() => undefined), 20);
    expect(performance.now() - started).toBeGreaterThanOrEqual(15);
  });
});
