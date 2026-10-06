import { describe, expect, test } from 'bun:test';
import { PDF_PIECE_TEMPLATE_ID } from '../../core/pdf/pdf-model';
import { batchQuitDialogText } from '../batch/batch-quit';
import { canceledPdfJobRecords, quitDialogText } from './pdf-quit';
import type { PdfPendingLabel } from './pdf-station';

const LABEL: PdfPendingLabel = {
  content: '面单.pdf 第 2 页第 3 张',
  fields: [{ name: '文件', value: '面单.pdf' }],
  paper: { widthMm: 100, heightMm: 150 },
  pdf: { file: '面单.pdf', page: 2, piece: 3, bitmap: '0f8fad5b-d9cb-469f-a165-70867728950e' },
};

describe('quitDialogText', () => {
  test('keeps the batch wording when only a batch is pending', () => {
    expect(quitDialogText(3, 0)).toEqual(batchQuitDialogText(3));
  });

  // PDF 的记录带着位图编号：7 天内能逐张重打，不说「按批次筛选」（PDF 没有批次）。
  test('says PDF labels were never sent and can be reprinted from the records for a week', () => {
    const { message, detail } = quitDialogText(0, 2);
    expect(message).toContain('2 张 PDF');
    expect(detail).toContain('还没交给打印机');
    expect(detail).toContain('退出时未打');
    expect(detail).toContain('7 天');
    expect(detail).not.toContain('批次');
  });

  test('counts both when a batch and a PDF are pending', () => {
    const { message, detail } = quitDialogText(3, 2);
    expect(message).toContain('3 张批量打印');
    expect(message).toContain('2 张 PDF');
    expect(detail).toContain('退出时未打');
  });
});

describe('canceledPdfJobRecords', () => {
  test('records one CANCELED PDF job per piece that still points at its bitmap', () => {
    const ids = ['a', 'b'];
    const records = canceledPdfJobRecords(
      [LABEL],
      () => ids.shift() ?? 'x',
      () => 42,
    );
    expect(records).toEqual([
      {
        id: 'a',
        createdAt: 42,
        raw: '面单.pdf 第 2 页第 3 张',
        printerName: '',
        source: 'pdf',
        status: 'failed',
        forced: false,
        failureReason: 'CANCELED',
        paper: '100x150',
        templateId: PDF_PIECE_TEMPLATE_ID,
        fields: [{ name: '文件', value: '面单.pdf' }],
        pdf: LABEL.pdf,
      },
    ]);
  });
});
