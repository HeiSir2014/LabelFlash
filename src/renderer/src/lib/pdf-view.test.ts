import { describe, expect, test } from 'bun:test';
import { PDF_PRINTING_ISSUE } from '../../../shared/pdf';
import {
  boxFromDrag,
  cropLabel,
  defaultPaperKey,
  describePieces,
  describeProcessing,
  isPdfFileName,
  isPdfPrinting,
  keepsResultOnIssue,
  movePiece,
  paperOptions,
  parseCopies,
  printCount,
  visibleOrder,
} from './pdf-view';

describe('isPdfFileName', () => {
  test('recognises PDF files by their extension', () => {
    expect(isPdfFileName('面单.PDF')).toBe(true);
    expect(isPdfFileName('rows.csv')).toBe(false);
    expect(isPdfFileName('pdf')).toBe(false);
  });
});

describe('papers', () => {
  const assigned = { '100x150': '面单机', '60x40': '标签机A' };

  test('lists assigned papers first with their printer, then the other presets', () => {
    const options = paperOptions(assigned);
    expect(options.slice(0, 2)).toEqual([
      { key: '100x150', label: '100×150 二联面单 · 面单机', hasPrinter: true },
      { key: '60x40', label: '60×40 标签 · 标签机A', hasPrinter: true },
    ]);
    expect(options.find((option) => option.key === '50x30')).toEqual({
      key: '50x30',
      label: '50×30 标签（没有分配打印机）',
      hasPrinter: false,
    });
    expect(options.filter((option) => option.key === '100x150')).toHaveLength(1);
  });

  test('starts with the 100×150 waybill paper when it has a printer, else the first assigned paper', () => {
    expect(defaultPaperKey(assigned)).toBe('100x150');
    expect(defaultPaperKey({ '60x40': '标签机A' })).toBe('60x40');
    expect(defaultPaperKey({})).toBe('100x150');
  });
});

describe('cropLabel', () => {
  test('marks the detected mode', () => {
    expect(cropLabel('split', 'split')).toBe('一页多张（自动识别）');
    expect(cropLabel('trim', 'split')).toBe('去白边');
    expect(cropLabel('page', null)).toBe('整页');
  });
});

describe('boxFromDrag', () => {
  test('normalises a drag in any direction and keeps it on the page', () => {
    expect(boxFromDrag({ x: 0.75, y: 0.5 }, { x: 0.25, y: 0.25 })).toEqual({
      x: 0.25,
      y: 0.25,
      width: 0.5,
      height: 0.25,
    });
    expect(boxFromDrag({ x: -0.25, y: 0.5 }, { x: 0.5, y: 1.5 })).toEqual({ x: 0, y: 0.5, width: 0.5, height: 0.5 });
  });

  test('ignores a click or a tiny drag', () => {
    expect(boxFromDrag({ x: 0.5, y: 0.5 }, { x: 0.505, y: 0.75 })).toBeNull();
  });
});

describe('order and counts', () => {
  const order = ['1-1', '1-2', '1-3'];

  test('moves a piece past the deleted ones and not off the ends', () => {
    expect(movePiece(order, '1-3', -1, new Set(['1-2']))).toEqual(['1-3', '1-2', '1-1']);
    expect(movePiece(order, '1-1', 1, new Set())).toEqual(['1-2', '1-1', '1-3']);
    expect(movePiece(order, '1-1', -1, new Set())).toEqual(order);
  });

  test('counts what will be printed', () => {
    expect(visibleOrder(order, new Set(['1-2']))).toEqual(['1-1', '1-3']);
    expect(printCount(order, new Set(['1-2']), 3)).toBe(6);
    expect(describePieces({ total: 3, removed: 1, copies: 3 })).toBe('共 3 张 · 删掉 1 张 · 每张 3 份 · 打 6 张');
    expect(describePieces({ total: 8, removed: 0, copies: 1 })).toBe('共 8 张 · 每张 1 份 · 打 8 张');
  });

  test('keeps copies within 1 to 99', () => {
    expect(parseCopies('3')).toBe(3);
    expect(parseCopies('0')).toBe(1);
    expect(parseCopies('500')).toBe(99);
    expect(parseCopies('')).toBe(1);
  });
});

describe('progress', () => {
  test('describes processing pages', () => {
    expect(describeProcessing({ done: 2, total: 200 })).toBe('正在处理第 3 / 200 页…');
    expect(describeProcessing({ done: 200, total: 200 })).toBe('正在处理第 200 / 200 页…');
  });
});

describe('isPdfPrinting', () => {
  // 主进程判定「正在打印」的窗口比 running/paused 更宽（取消后最后一张还在送也算）：界面按主进程的
  // isActive 来，不能自己按 print.state 猜，不然会有一段时间两边不一致。
  test('follows the status reported by main, not the print state alone', () => {
    expect(isPdfPrinting({ fileName: 'a.pdf', processing: null, print: null, isActive: true })).toBe(true);
    expect(
      isPdfPrinting({
        fileName: 'a.pdf',
        processing: null,
        print: { batchId: 'b', state: 'canceled', total: 1, sent: 0, failed: 0, pauseReason: null },
        isActive: true,
      }),
    ).toBe(true);
    expect(isPdfPrinting({ fileName: 'a.pdf', processing: null, print: null, isActive: false })).toBe(false);
    expect(isPdfPrinting(null)).toBe(false);
  });
});

describe('keepsResultOnIssue', () => {
  // 主进程因为「正在打印」拒绝出块、关文件时，界面不能清空已经出好的块重来：那只是暂时拒绝，
  // 不是这次出块真的作废了。其余原因（文件坏了、处理出错……）照常清空。
  test('only keeps the current result for the shared "printing" refusal', () => {
    expect(keepsResultOnIssue(PDF_PRINTING_ISSUE)).toBe(true);
    expect(keepsResultOnIssue('处理 PDF 时出错：详细原因已写入日志，重新选择文件再试')).toBe(false);
  });
});
