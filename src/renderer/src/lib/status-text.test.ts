import { describe, expect, test } from 'bun:test';
import type { ScanResult } from '../../../core/scan/scan-result';
import type { LabelPreview } from '../../../shared/ipc-contract';
import { NO_RENDER_WARNINGS } from '../../../shared/render-warnings';
import {
  describeJobMeta,
  describeJobStatus,
  describeResult,
  describeSamplePrint,
  describeScan,
  describeSource,
  formatAgo,
  formatDateTime,
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
const PRINTER_CHOICE = { printerName: '热敏标签机', reason: 'paper' } as const;
const OK_PREVIEW: LabelPreview = {
  result: {
    status: 'ok',
    scan: SCAN,
    recent: null,
    lookupFailure: null,
    printer: PRINTER_CHOICE,
  },
  html: '<html></html>',
  templateId: 'builtin:big-qr',
  templateName: '通用 · 大二维码 + 日期备注',
  isTemplateBound: true,
  warnings: NO_RENDER_WARNINGS,
  paper: { widthMm: 60, heightMm: 40 },
};
const INVALID_PREVIEW = (reason: 'INVALID_CONTENT' | 'NO_MATCHING_RULE'): LabelPreview => ({
  result: { status: 'invalid', reason },
  html: null,
  templateId: null,
  templateName: null,
  isTemplateBound: false,
  warnings: NO_RENDER_WARNINGS,
  paper: null,
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
  now: NOW,
  queryingRaw: null,
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
  test('tells which paper has no printer and offers to open the printer panel', () => {
    expect(describeResult({ status: 'no-printer', paperKey: '100x180', missingPrinter: null }, NOW)).toEqual({
      tone: 'warning',
      title: '没有可用的打印机',
      detail: '100×180 二联面单 还没有打印机',
      link: { page: 'printers', label: '去指定打印机' },
    });
  });

  test('says when the printer named by the template is not on this computer', () => {
    const result = { status: 'no-printer', paperKey: '100x180', missingPrinter: '面单机D' } as const;
    expect(describeResult(result, NOW).detail).toBe(
      '模板指定的 面单机D 不在这台电脑上，100×180 二联面单 也还没有打印机',
    );
  });

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

  test('a driver failure shows what the adapter knows, or points at the printer', () => {
    const canceled = describeResult({ status: 'failed', reason: 'PRINT_ERROR', detail: '打印被取消了' }, NOW);
    expect(canceled).toMatchObject({ title: '打印失败', detail: '打印被取消了' });
    expect(describeResult({ status: 'failed', reason: 'PRINT_ERROR' }, NOW).detail).toBe(
      '打印机驱动报错，检查打印机状态后重试',
    );
  });
});

describe('describeScan', () => {
  // 没扫码时状态条不说话：扫码框里已经写了怎么扫，「自动打印」开关就是打不打印的模式，再写一遍是重复。
  test('says nothing while waiting for a scan', () => {
    for (const autoPrint of [true, false]) {
      expect(describeScan(null, context({ autoPrint })).status).toEqual({ tone: 'idle', title: '', detail: '' });
    }
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

  test('points to the rules page when no rule recognises the content', () => {
    const noRule = describeScan(snapshot({ preview: INVALID_PREVIEW('NO_MATCHING_RULE') }), context());
    expect(noRule.status.link).toEqual({ page: 'rules', label: '打开「识别规则」' });
    expect(noRule.status.detail).toContain('配置 › 识别规则');
    const unreadable = describeScan(snapshot({ preview: INVALID_PREVIEW('INVALID_CONTENT') }), context());
    expect(unreadable.status.link).toBeUndefined();
  });

  test('printing is pending', () => {
    expect(describeScan(snapshot({ isPrinting: true }), context()).status.tone).toBe('pending');
  });

  test('a slow lookup shows the new scan as querying, with nothing to press until it returns', () => {
    const querying = { queryingRaw: '订单号：A001\n款号：CL5640' };
    for (const previous of [null, snapshot(), snapshot({ hasIpcError: true })]) {
      const view = describeScan(previous, context(querying));
      expect(view.status).toEqual({ tone: 'pending', title: '正在查询…', detail: '订单号：A001' });
      expect(view.actions).toEqual({ print: null, forceReprint: false });
    }
  });

  test('manual mode offers print for a fresh label', () => {
    const view = describeScan(snapshot(), context());
    expect(view.status.title).toBe('待打印');
    expect(view.actions).toEqual({ print: 'print', forceReprint: false });
  });

  test('manual mode still lets F2 submit a recently printed label (the threshold decides) and offers force', () => {
    const preview: LabelPreview = {
      ...OK_PREVIEW,
      result: {
        status: 'ok',
        scan: SCAN,
        recent: { state: 'printed', at: NOW - 2 * MINUTE },
        lookupFailure: null,
        printer: PRINTER_CHOICE,
      },
    };
    const view = describeScan(snapshot({ preview }), context());
    expect(view.status).toMatchObject({ tone: 'warning', title: '2 分钟前已打印过' });
    expect(view.actions).toEqual({ print: 'print', forceReprint: true });
  });

  test('a lookup that failed during preview offers a retry instead of printing blank data', () => {
    const preview: LabelPreview = {
      ...OK_PREVIEW,
      result: { status: 'ok', scan: SCAN, recent: null, lookupFailure: '查询超时', printer: PRINTER_CHOICE },
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

  // 手动模式下预览出来这种纸没有打印机：说清是哪种纸；指定好打印机后 F2 直接打（主进程重新决定打印机）。
  test('names the paper that has no printer and still lets F2 try again', () => {
    const preview: LabelPreview = {
      ...OK_PREVIEW,
      result: {
        status: 'ok',
        scan: SCAN,
        recent: null,
        lookupFailure: null,
        printer: { printerName: null, reason: 'unassigned', paperKey: '100x180', missingPrinter: null },
      },
    };
    const view = describeScan(snapshot({ preview }), context());
    expect(view.status).toMatchObject({ title: '没有可用的打印机', detail: '100×180 二联面单 还没有打印机' });
    expect(view.actions.print).toBe('retry');
  });

  test('offers a retry after a no-printer result', () => {
    const print = { status: 'no-printer', paperKey: '100x180', missingPrinter: null } as const;
    expect(describeScan(snapshot({ print }), context()).actions.print).toBe('retry');
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

describe('describeJobMeta', () => {
  const job = { id: 'j', createdAt: NOW, raw: SCAN.raw, source: 'desktop' as const, status: 'printed' as const };

  test('shows the time, source, printer and paper of a job', () => {
    expect(describeJobMeta({ ...job, printerName: '面单机B', forced: false, paper: '100x180' })).toBe(
      `${formatDateTime(NOW)} · ${describeSource('desktop')} · 面单机B · 100×180 二联面单`,
    );
  });

  // 1.0.x 的旧记录没有纸张；识别不了的记录没有打印机。
  test('shows a dash for jobs without paper and skips an empty printer', () => {
    expect(describeJobMeta({ ...job, printerName: '', forced: false })).toBe(
      `${formatDateTime(NOW)} · ${describeSource('desktop')} · —`,
    );
  });

  test('shows the page and piece of a PDF job', () => {
    const pdfJob = {
      ...job,
      source: 'pdf' as const,
      printerName: 'P',
      forced: false,
      pdf: { file: 'a.pdf', page: 2, piece: 1, bitmap: '0f8fad5b-d9cb-469f-a165-70867728950e' },
    };
    expect(describeJobMeta(pdfJob)).toContain('PDF（第 2 页第 1 张）');
  });

  test('shows the computer and user of a LAN share job', () => {
    const shared = {
      ...job,
      source: 'ipp' as const,
      printerName: 'P',
      forced: false,
      ipp: { client: '192.168.1.23', user: 'zhang' },
    };
    expect(describeJobMeta(shared)).toContain('局域网共享（192.168.1.23 zhang）');
    expect(describeJobMeta({ ...shared, ipp: { client: '192.168.1.23', user: '' } })).toContain(
      '局域网共享（192.168.1.23）',
    );
    expect(describeJobMeta({ ...shared, source: 'history' })).toContain('（原提交：192.168.1.23 zhang）');
  });

  test('names who submitted a job through the local api', () => {
    expect(
      describeJobMeta({ ...job, source: 'api', printerName: '标签机A', forced: false, paper: '60x40' }, 'ERP'),
    ).toBe(`${formatDateTime(NOW)} · 本机接口（ERP） · 标签机A · 60×40 标签`);
  });

  // 从接口记录重打的那一张不是调用方这次提交的。
  test('says a reprint of a local api job was originally submitted by the caller', () => {
    expect(
      describeJobMeta({ ...job, source: 'history', printerName: '标签机A', forced: false, paper: '60x40' }, 'ERP'),
    ).toBe(`${formatDateTime(NOW)} · 记录重打（原提交：ERP） · 标签机A · 60×40 标签`);
  });

  test('shows the row and copy of a batch job', () => {
    const batchJob = { ...job, source: 'batch' as const, printerName: 'P', forced: false };
    expect(describeJobMeta({ ...batchJob, batch: { id: '20261002-143501-a1b2', row: 3, copy: 2 } })).toContain(
      '批量（第 3 行第 2 份）',
    );
    expect(describeJobMeta({ ...batchJob, batch: { id: '20261002-143501-a1b2', row: 3, copy: 1 } })).toContain(
      '批量（第 3 行）',
    );
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

describe('describeSource', () => {
  test('names jobs submitted through the local api', () => {
    expect(describeSource('api')).toBe('本机接口');
  });

  test('names batch, PDF and LAN sharing prints', () => {
    expect(describeSource('batch')).toBe('批量');
    expect(describeSource('pdf')).toBe('PDF');
    expect(describeSource('ipp')).toBe('局域网共享');
  });
});

describe('describeSamplePrint', () => {
  test('says the sample was sent, with the first fields', () => {
    expect(describeSamplePrint({ status: 'printed', jobId: 'sample', scan: SCAN }, NOW)).toEqual({
      tone: 'info',
      message: '已发送打印：CL5640-TK · 图片色 · XL',
    });
  });

  test('says which paper has no printer, pointing at the printers page instead of a button the designer has', () => {
    expect(describeSamplePrint({ status: 'no-printer', paperKey: '60x40', missingPrinter: null }, NOW)).toEqual({
      tone: 'warning',
      message: '60×40 标签 还没有打印机：在「配置 › 打印机」里给这种纸指定打印机',
    });
  });

  test('names the printer the template specified when it is missing from this computer', () => {
    expect(
      describeSamplePrint({ status: 'no-printer', paperKey: '60x40', missingPrinter: '热敏标签机A' }, NOW),
    ).toEqual({
      tone: 'warning',
      message:
        '模板指定的 热敏标签机A 不在这台电脑上，60×40 标签 还没有打印机：在「配置 › 打印机」里给这种纸指定打印机',
    });
  });

  test('says the printer may already have printed instead of pointing at "强制补打"', () => {
    expect(describeSamplePrint({ status: 'failed', reason: 'PRINT_TIMEOUT' }, NOW)).toEqual({
      tone: 'error',
      message: '打印机没有响应，可能已经出纸；确认后再点「打印一张试试」',
    });
  });

  test('keeps the not-ready reason and points back at the sample button instead of "重试打印"', () => {
    expect(describeSamplePrint({ status: 'failed', reason: 'PRINTER_NOT_READY', detail: '打印机离线' }, NOW)).toEqual({
      tone: 'error',
      message: '打印机离线，处理好后再点「打印一张试试」',
    });
  });

  test('says a failed lookup did not print, keeps the reason, and points back at the sample button', () => {
    expect(describeSamplePrint({ status: 'failed', reason: 'LOOKUP_FAILED', detail: '查询超时' }, NOW)).toEqual({
      tone: 'error',
      message: '数据查询失败，没有打印：查询超时；处理好后再点「打印一张试试」',
    });
  });

  test('reports a printer failure as an error', () => {
    expect(describeSamplePrint({ status: 'failed', reason: 'PRINTER_NOT_FOUND' }, NOW)).toEqual({
      tone: 'error',
      message: '找不到打印机：系统里找不到这台打印机，刷新打印机列表后重新选择',
    });
  });
});
