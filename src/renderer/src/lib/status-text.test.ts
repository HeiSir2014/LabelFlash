import { describe, expect, test } from 'bun:test';
import type { ScanResult } from '../../../core/scan/scan-result';
import type { LabelPreview } from '../../../shared/ipc-contract';
import {
  describeJobStatus,
  describeResult,
  describeScan,
  formatAgo,
  formatWindow,
  IPC_ERROR_VIEW,
  type ScanContext,
  type ScanSnapshot,
} from './status-text';

const NOW = Date.UTC(2026, 8, 28, 9, 0, 0);
const MINUTE = 60_000;
const SCAN: ScanResult = {
  raw: 'CL5640-TK-图片色-XL',
  ruleId: 'builtin:dash-three',
  ruleName: '横杠三段（编码-颜色-尺码）',
  fields: [
    { name: '编码', value: 'CL5640-TK' },
    { name: '颜色', value: '图片色' },
    { name: '尺码', value: 'XL' },
  ],
};
const OK_PREVIEW: LabelPreview = {
  result: { status: 'ok', scan: SCAN, recent: null, lookupFailure: null },
  html: '<html></html>',
  templateName: '样衣标准（二维码在左）',
  qrOmitted: false,
};
const INVALID_PREVIEW = (reason: 'INVALID_CONTENT' | 'NO_MATCHING_RULE'): LabelPreview => ({
  result: { status: 'invalid', reason },
  html: null,
  templateName: null,
  qrOmitted: false,
});

const snapshot = (overrides: Partial<ScanSnapshot> = {}): ScanSnapshot => ({
  raw: SCAN.raw,
  preview: OK_PREVIEW,
  print: null,
  isPrinting: false,
  hasIpcError: false,
  ...overrides,
});
const context = (overrides: Partial<ScanContext> = {}): ScanContext => ({
  autoPrint: false,
  hasPrinter: true,
  now: NOW,
  ...overrides,
});

describe('formatAgo / formatWindow', () => {
  test('formats relative time', () => {
    expect(formatAgo(NOW - 30_000, NOW)).toBe('刚刚');
    expect(formatAgo(NOW - 3.5 * MINUTE, NOW)).toBe('3 分钟前');
    expect(formatAgo(NOW - 125 * MINUTE, NOW)).toBe('2 小时前');
  });

  test('formats the dedup window in the largest whole unit', () => {
    expect(formatWindow(3_000)).toBe('3 秒');
    expect(formatWindow(90_000)).toBe('90 秒');
    expect(formatWindow(10 * MINUTE)).toBe('10 分钟');
    expect(formatWindow(120 * MINUTE)).toBe('2 小时');
  });
});

describe('describeResult', () => {
  test('printed means sent to the printer', () => {
    expect(describeResult({ status: 'printed', jobId: 'j', scan: SCAN }, NOW)).toEqual({
      tone: 'success',
      title: '已发送打印',
      detail: 'CL5640-TK · 图片色 · XL',
    });
  });

  test('printed lists at most three field values, multi-line values on one line', () => {
    const scan: ScanResult = {
      ...SCAN,
      fields: [
        { name: '订单号', value: 'A001' },
        { name: '地址', value: '一号楼\n三单元' },
        { name: '款号', value: 'CL5640' },
        { name: '数量', value: '2' },
      ],
    };
    expect(describeResult({ status: 'printed', jobId: 'j', scan }, NOW).detail).toBe('A001 · 一号楼 / 三单元 · CL5640');
  });

  test('duplicate explains when and why', () => {
    const printed = describeResult(
      { status: 'duplicate', recent: { state: 'printed', at: NOW - 3 * MINUTE }, windowMs: 10 * MINUTE },
      NOW,
    );
    expect(printed.detail).toBe('3 分钟前已打印过，10 分钟内同一标签只打一次');
    const bounced = describeResult(
      { status: 'duplicate', recent: { state: 'printed', at: NOW - 1_000 }, windowMs: 3_000 },
      NOW,
    );
    expect(bounced.detail).toBe('刚刚已打印过，3 秒内同一标签只打一次');
    const printing = describeResult(
      { status: 'duplicate', recent: { state: 'printing', at: NOW }, windowMs: 10 * MINUTE },
      NOW,
    );
    expect(printing.detail).toStartWith('同一标签正在打印');
  });

  test('not-ready failures show the printer-reported reason', () => {
    const view = describeResult({ status: 'failed', reason: 'PRINTER_NOT_READY', detail: '缺纸' }, NOW);
    expect(view).toMatchObject({ tone: 'error', title: '打印机未就绪' });
    expect(view.detail).toStartWith('缺纸');
  });

  test('timeouts say the label may already be printed', () => {
    expect(describeResult({ status: 'failed', reason: 'PRINT_TIMEOUT' }, NOW).detail).toContain('可能已出纸');
  });
});

describe('describeScan', () => {
  test('waiting state mentions F2 in manual mode', () => {
    const view = describeScan(null, context());
    expect(view.status.tone).toBe('idle');
    expect(view.status.detail).toContain('F2');
  });

  test('IPC failures are shown as internal errors, not as format errors', () => {
    expect(describeScan(snapshot({ hasIpcError: true }), context()).status).toEqual(IPC_ERROR_VIEW);
  });

  test('invalid preview is an error with no actions, worded by reason', () => {
    const noRule = describeScan(snapshot({ preview: INVALID_PREVIEW('NO_MATCHING_RULE') }), context());
    expect(noRule.status).toMatchObject({ tone: 'error', title: '没有匹配的识别规则' });
    expect(noRule.actions).toEqual({ print: null, forceReprint: false });
    const unreadable = describeScan(snapshot({ preview: INVALID_PREVIEW('INVALID_CONTENT') }), context());
    expect(unreadable.status.title).toBe('扫码内容无法识别');
  });

  test('printing is pending', () => {
    expect(describeScan(snapshot({ isPrinting: true }), context()).status.tone).toBe('pending');
  });

  test('manual mode offers print for a fresh label', () => {
    const view = describeScan(snapshot(), context());
    expect(view.status.title).toBe('待打印');
    expect(view.actions).toEqual({ print: 'print', forceReprint: false });
  });

  test('manual mode still lets F2 submit a recently printed label (the threshold decides) and offers force', () => {
    const preview: LabelPreview = {
      ...OK_PREVIEW,
      result: { status: 'ok', scan: SCAN, recent: { state: 'printed', at: NOW - 2 * MINUTE }, lookupFailure: null },
    };
    const view = describeScan(snapshot({ preview }), context());
    expect(view.status).toMatchObject({ tone: 'warning', title: '2 分钟前已打印过' });
    expect(view.actions).toEqual({ print: 'print', forceReprint: true });
  });

  test('a lookup that failed during preview offers a retry instead of printing blank data', () => {
    const preview: LabelPreview = {
      ...OK_PREVIEW,
      result: { status: 'ok', scan: SCAN, recent: null, lookupFailure: '查询超时' },
    };
    const view = describeScan(snapshot({ preview }), context());
    expect(view.status).toMatchObject({ tone: 'error', title: '数据查询失败' });
    expect(view.status.detail).toContain('查询超时');
    expect(view.actions).toEqual({ print: 'retry', forceReprint: false });
  });

  test('a blocked print explains the lookup failure', () => {
    const view = describeResult({ status: 'failed', reason: 'LOOKUP_FAILED', detail: '返回 500' }, NOW);
    expect(view).toMatchObject({ tone: 'error', title: '数据查询失败，没有打印' });
    expect(view.detail).toContain('返回 500');
  });

  test('no printer selected blocks printing in both modes', () => {
    for (const autoPrint of [true, false]) {
      const view = describeScan(snapshot(), context({ hasPrinter: false, autoPrint }));
      expect(view.status.title).toBe('还没选打印机');
      expect(view.actions.print).toBeNull();
    }
  });

  test('retryable failures offer retry; timeouts only offer force reprint', () => {
    const notReady = describeScan(snapshot({ print: { status: 'failed', reason: 'PRINTER_NOT_READY' } }), context());
    expect(notReady.actions).toEqual({ print: 'retry', forceReprint: false });
    const timeout = describeScan(snapshot({ print: { status: 'failed', reason: 'PRINT_TIMEOUT' } }), context());
    expect(timeout.actions).toEqual({ print: null, forceReprint: true });
  });

  test('a duplicate of a finished print offers force reprint, one still printing does not', () => {
    const printed = snapshot({
      print: { status: 'duplicate', recent: { state: 'printed', at: NOW }, windowMs: 10 * MINUTE },
    });
    expect(describeScan(printed, context()).actions).toEqual({ print: null, forceReprint: true });
    const printing = snapshot({
      print: { status: 'duplicate', recent: { state: 'printing', at: NOW }, windowMs: 10 * MINUTE },
    });
    expect(describeScan(printing, context()).actions.forceReprint).toBe(false);
  });
});

describe('describeJobStatus', () => {
  const base = { id: 'j', createdAt: NOW, raw: SCAN.raw, printerName: 'P', source: 'desktop' as const, forced: false };

  test('marks forced reprints', () => {
    expect(describeJobStatus({ ...base, status: 'printed', forced: true })).toEqual({
      tone: 'success',
      text: '已补打',
    });
  });

  test('includes the failure reason', () => {
    expect(describeJobStatus({ ...base, status: 'failed', failureReason: 'PRINTER_NOT_READY' })).toEqual({
      tone: 'error',
      text: '失败：未就绪',
    });
  });
});
