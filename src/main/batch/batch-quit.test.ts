import { describe, expect, test } from 'bun:test';
import { CANVAS_TAG } from '../../core/templates/builtin-canvas';
import { batchQuitDialogText, canceledJobRecords, shouldConfirmBatchQuit } from './batch-quit';

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
        fields: [],
        batch: { id: '20261002-143501-a1b2', row: 7, copy: 2 },
      },
    ]);
  });
});
