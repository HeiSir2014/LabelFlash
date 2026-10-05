import { describe, expect, test } from 'bun:test';
import { DEFAULT_PAPER } from '../shared/label-paper';
import { DedupGuard } from './dedup-guard';
import { PrintError } from './errors';
import { PrintQueue } from './print-queue';
import {
  API_RULE,
  BATCH_RULE,
  type FieldsPrint,
  fieldsRuleFor,
  PDF_RULE,
  PrintService,
  TEST_RAW,
} from './print-service';
import type { PrinterChoice } from './printing/resolve-printer';
import { BUILT_IN_RULES, DASH_THREE_RULE_ID, RAW_RULE_ID } from './scan/builtin-rules';
import type { EnrichContext, EnrichResult } from './scan/enrich';
import { MAX_RAW_LENGTH } from './scan/normalize-raw';
import { recognize } from './scan/recognize';
import type { ScanRule } from './scan/rule-model';
import { fieldValue, type ScanResult } from './scan/scan-result';
import { BUILT_IN_TEMPLATES, GENERIC_TEMPLATE } from './templates/builtin-templates';
import { PLATFORM_TWO_PART } from './templates/builtin-waybills';
import type { LabelTemplate } from './templates/template-model';
import { FAKE_CLOCK_START, FakeClock } from './testing/fake-clock';
import { FakePrinterAdapter } from './testing/fake-printer-adapter';
import { InMemoryJobStore } from './testing/in-memory-job-store';
import { PICK_TEMPLATE } from './testing/templates';
import type { JobRecord, PrintRequest } from './types';

const WINDOW_MS = 10 * 60_000;
const RAW = 'CL5640-TK-图片色-XL';
const PRINTER = '热敏标签机';
const RAW_SCAN: ScanResult = {
  raw: RAW,
  ruleId: DASH_THREE_RULE_ID,
  ruleName: '横杠三段（编码-颜色-尺码）',
  fields: [
    { name: '编码', value: 'CL5640-TK' },
    { name: '颜色', value: '图片色' },
    { name: '尺码', value: 'XL' },
  ],
};

const noRegex = () => null;

function createHarness(store = new InMemoryJobStore()) {
  const clock = new FakeClock();
  const adapter = new FakePrinterAdapter();
  const guard = new DedupGuard(clock, WINDOW_MS);
  let template: LabelTemplate = PICK_TEMPLATE;
  let rules: readonly ScanRule[] = BUILT_IN_RULES;
  const templateRequests: ScanResult[] = [];
  const recorded: Array<{ job: JobRecord; scan: ScanResult | null }> = [];
  let enrichScan: (scan: ScanResult, context: EnrichContext) => Promise<EnrichResult> = async (scan) => ({
    scan,
    traces: [],
    blocked: null,
  });
  let nextId = 0;
  let choice: PrinterChoice = { printerName: PRINTER, reason: 'paper' };
  let resolveTemplate = (_scan: ScanResult): LabelTemplate => template;
  let choosePrinter = async (_template: LabelTemplate): Promise<PrinterChoice> => choice;
  const service = new PrintService({
    adapter,
    store,
    guard,
    clock,
    queue: new PrintQueue(1_000),
    createId: () => `job-${++nextId}`,
    recognize: (raw) => recognize(raw, rules, noRegex),
    enrich: (scan, context) => enrichScan(scan, context),
    resolveTemplate: (scan) => {
      templateRequests.push(scan);
      return resolveTemplate(scan);
    },
    onRecorded: (job, scan) => recorded.push({ job, scan }),
    choosePrinter: (chosen) => choosePrinter(chosen),
  });
  /** 按字段换模板、按纸张找打印机：模板和打印机随扫码内容变的用例用。 */
  const useResolveTemplate = (next: (scan: ScanResult) => LabelTemplate) => {
    resolveTemplate = next;
  };
  const useChoosePrinter = (next: (template: LabelTemplate) => Promise<PrinterChoice>) => {
    choosePrinter = next;
  };
  const useTemplate = (next: LabelTemplate) => {
    template = next;
  };
  const useRules = (next: readonly ScanRule[]) => {
    rules = next;
  };
  const useEnrich = (next: (scan: ScanResult, context: EnrichContext) => Promise<EnrichResult>) => {
    enrichScan = next;
  };
  const useChoice = (next: PrinterChoice) => {
    choice = next;
  };
  return {
    clock,
    adapter,
    store,
    service,
    useTemplate,
    useRules,
    useEnrich,
    useChoice,
    useResolveTemplate,
    useChoosePrinter,
    templateRequests,
    recorded,
  };
}

const withShelf = async (scan: ScanResult): Promise<EnrichResult> => ({
  scan: { ...scan, fields: [...scan.fields, { name: '货架号', value: 'A-01' }] },
  traces: [],
  blocked: null,
});

const lookupFails = async (scan: ScanResult): Promise<EnrichResult> => ({
  scan,
  traces: [],
  blocked: { stepIndex: 0, detail: '查询超时', reason: 'LOOKUP_FAILED', field: null },
});

const shelfNotRead = async (scan: ScanResult): Promise<EnrichResult> => ({
  scan,
  traces: [],
  blocked: { stepIndex: 0, detail: '没认出货架号', reason: 'TEXT_NOT_FOUND', field: '货架号' },
});

function request(overrides: Partial<PrintRequest> = {}): PrintRequest {
  return { raw: RAW, source: 'desktop', ...overrides };
}

describe('PrintService.submit', () => {
  test('prints a recognised scan with the template resolved for it and records it', async () => {
    const { service, adapter, store, templateRequests } = createHarness();
    const result = await service.submit(request());
    expect(result).toEqual({ status: 'printed', jobId: 'job-1', scan: RAW_SCAN });
    expect(templateRequests).toEqual([RAW_SCAN]);
    expect(adapter.printed).toEqual([
      { printerName: PRINTER, raw: RAW, templateId: PICK_TEMPLATE.id, paper: '60x40', fields: RAW_SCAN.fields },
    ]);
    expect(store.listRecent(1)[0]).toMatchObject({
      id: 'job-1',
      raw: RAW,
      printerName: PRINTER,
      source: 'desktop',
      status: 'printed',
      forced: false,
    });
  });

  test('uses the template that is active at print time', async () => {
    const { service, adapter, useTemplate } = createHarness();
    const [, second] = BUILT_IN_TEMPLATES;
    if (!second) throw new Error('expected more than one built-in template');
    useTemplate(second);
    await service.submit(request());
    expect(adapter.printed[0]?.templateId).toBe(second.id);
  });

  test('prints a numeric order number through the order-number rule', async () => {
    const { service } = createHarness();
    const result = await service.submit(request({ raw: '202609280001' }));
    expect(result).toMatchObject({
      status: 'printed',
      scan: { ruleId: 'builtin:digits-order', fields: [{ name: '订单号', value: '202609280001' }] },
    });
  });

  test('dedups multi-line content by its normalised form', async () => {
    const { service, adapter } = createHarness();
    const multiLine = '订单号：A001\r\n款号：CL5640\r\n';
    expect((await service.submit(request({ raw: multiLine }))).status).toBe('printed');
    expect((await service.submit(request({ raw: '订单号：A001\n款号：CL5640' }))).status).toBe('duplicate');
    expect(adapter.printed.map((p) => p.raw)).toEqual(['订单号：A001\n款号：CL5640']);
  });

  test('rejects content that is too long without printing and stores a truncated copy', async () => {
    const { service, adapter, store } = createHarness();
    const tooLong = 'x'.repeat(MAX_RAW_LENGTH + 500);
    expect(await service.submit(request({ raw: `  ${tooLong}  ` }))).toEqual({
      status: 'invalid',
      reason: 'INVALID_CONTENT',
    });
    expect(adapter.printed).toHaveLength(0);
    expect(store.listRecent(1)[0]).toMatchObject({ status: 'invalid', raw: 'x'.repeat(MAX_RAW_LENGTH) });
  });

  test('reports valid content that no enabled rule recognises', async () => {
    const { service, adapter, useRules } = createHarness();
    useRules(BUILT_IN_RULES.filter((rule) => rule.id !== RAW_RULE_ID));
    expect(await service.submit(request({ raw: '???' }))).toEqual({ status: 'invalid', reason: 'NO_MATCHING_RULE' });
    expect(adapter.printed).toHaveLength(0);
  });

  test('blocks and records a repeat scan inside the window', async () => {
    const { service, adapter, clock, store } = createHarness();
    await service.submit(request());
    const printedAt = clock.now();
    clock.advance(60_000);
    expect(await service.submit(request())).toEqual({
      status: 'duplicate',
      recent: { state: 'printed', at: printedAt },
      windowMs: WINDOW_MS,
    });
    expect(adapter.printed).toHaveLength(1);
    expect(store.listRecent(1)[0]?.status).toBe('duplicate');
  });

  test('concurrent scans of the same code print once', async () => {
    const { service, adapter } = createHarness();
    const release = adapter.hold();
    const first = service.submit(request());
    const second = await service.submit(request({ source: 'history' }));
    expect(second).toMatchObject({ status: 'duplicate', recent: { state: 'printing' } });
    release();
    expect((await first).status).toBe('printed');
    expect(adapter.printed).toHaveLength(1);
  });

  test('a printer that is not ready fails with detail and issue, and can be retried immediately', async () => {
    const { service, adapter } = createHarness();
    adapter.failNext(new PrintError('PRINTER_NOT_READY', 'offline', { detail: '打印机离线', issue: 'offline' }));
    expect(await service.submit(request())).toEqual({
      status: 'failed',
      reason: 'PRINTER_NOT_READY',
      detail: '打印机离线',
      issue: 'offline',
    });
    expect((await service.submit(request())).status).toBe('printed');
  });

  test('a timeout is treated as possibly printed: re-scans are blocked until forced', async () => {
    const { service, adapter } = createHarness();
    adapter.failNext(new PrintError('PRINT_TIMEOUT'));
    expect(await service.submit(request())).toEqual({ status: 'failed', reason: 'PRINT_TIMEOUT' });
    expect((await service.submit(request())).status).toBe('duplicate');
    expect((await service.submit(request({ force: true }))).status).toBe('printed');
  });

  test('unexpected errors are reported as PRINT_ERROR', async () => {
    const { service, adapter, store } = createHarness();
    adapter.failNext(new Error('driver crashed'));
    expect(await service.submit(request())).toEqual({ status: 'failed', reason: 'PRINT_ERROR' });
    expect(store.listRecent(1)[0]?.failureReason).toBe('PRINT_ERROR');
  });

  test('force reprints inside the window and is recorded as forced', async () => {
    const { service, adapter, store } = createHarness();
    await service.submit(request());
    expect((await service.submit(request({ force: true, source: 'history' }))).status).toBe('printed');
    expect(adapter.printed).toHaveLength(2);
    expect(store.listRecent(1)[0]).toMatchObject({ forced: true, source: 'history' });
  });

  test('a history write failure does not turn a printed job into a failure', async () => {
    const failingStore = new InMemoryJobStore();
    failingStore.append = () => {
      throw new Error('disk full');
    };
    const { service } = createHarness(failingStore);
    expect((await service.submit(request())).status).toBe('printed');
  });
});

describe('PrintService.preview', () => {
  test('recognises the scan and reports no recent print', async () => {
    const { service } = createHarness();
    expect(await service.preview(RAW)).toEqual({
      status: 'ok',
      scan: RAW_SCAN,
      recent: null,
      lookupFailure: null,
      printer: { printerName: PRINTER, reason: 'paper' },
    });
  });

  test('reports a recent print inside the window', async () => {
    const { service, clock } = createHarness();
    await service.submit(request());
    const printedAt = clock.now();
    clock.advance(30_000);
    expect(await service.preview(RAW)).toMatchObject({ recent: { state: 'printed', at: printedAt } });
  });

  test('rejects blank input and content no rule recognises', async () => {
    const { service, useRules } = createHarness();
    expect(await service.preview('   ')).toEqual({ status: 'invalid', reason: 'INVALID_CONTENT' });
    useRules([]);
    expect(await service.preview(RAW)).toEqual({ status: 'invalid', reason: 'NO_MATCHING_RULE' });
  });

  test('shows the processed fields and warns when a blocking lookup failed', async () => {
    const { service, useEnrich } = createHarness();
    useEnrich(withShelf);
    expect(await service.preview(RAW)).toMatchObject({ scan: { fields: [{}, {}, {}, { name: '货架号' }] } });
    useEnrich(lookupFails);
    expect(await service.preview(RAW)).toMatchObject({ status: 'ok', lookupFailure: '查询超时' });
  });
});

describe('PrintService processing steps', () => {
  test('prints the processed scan but dedups on the raw content', async () => {
    const { service, useEnrich, adapter } = createHarness();
    useEnrich(withShelf);
    const result = await service.submit(request());
    expect(result).toMatchObject({ status: 'printed', scan: { raw: RAW } });
    expect(adapter.printed.at(-1)?.fields.at(-1)).toEqual({ name: '货架号', value: 'A-01' });
    expect((await service.submit(request())).status).toBe('duplicate');
  });

  test('a blocking lookup failure does not print, is recorded, and can be retried at once', async () => {
    const { service, useEnrich, adapter, store } = createHarness();
    useEnrich(lookupFails);
    expect(await service.submit(request())).toEqual({ status: 'failed', reason: 'LOOKUP_FAILED', detail: '查询超时' });
    expect(adapter.printed).toHaveLength(0);
    expect(store.listRecent(1)[0]).toMatchObject({ status: 'failed', failureReason: 'LOOKUP_FAILED' });
    useEnrich(withShelf);
    expect((await service.submit(request())).status).toBe('printed');
  });

  // 手机扫码没认出货架号：不打印，记下原因和字段名（手机据此显示输入框），马上可以重扫或手动补。
  test('an unread shelf number does not print, is recorded with the field, and can be retried at once', async () => {
    const { service, useEnrich, adapter, store } = createHarness();
    useEnrich(shelfNotRead);
    expect(await service.submit(request({ source: 'mobile' }))).toEqual({
      status: 'failed',
      reason: 'TEXT_NOT_FOUND',
      detail: '没认出货架号',
      field: '货架号',
    });
    expect(adapter.printed).toHaveLength(0);
    expect(store.listRecent(1)[0]).toMatchObject({ status: 'failed', failureReason: 'TEXT_NOT_FOUND' });
    useEnrich(withShelf);
    expect((await service.submit(request({ source: 'mobile' }))).status).toBe('printed');
  });

  test('hands the phone frames and typed fields to the processing steps', async () => {
    const { service, useEnrich } = createHarness();
    const contexts: EnrichContext[] = [];
    useEnrich(async (scan, context) => {
      contexts.push(context);
      return { scan, traces: [], blocked: null };
    });
    const images = [1, 2].map((byte) => ({ jpeg: new Uint8Array([byte]), code: { x: 1, y: 2, size: 3 } }));
    await service.submit(request({ source: 'mobile', images, manualFields: { 货架号: 'A-1-2-3' } }));
    await service.submit(request({ raw: 'other', force: true }));
    expect(contexts).toEqual([
      { images, manualFields: { 货架号: 'A-1-2-3' } },
      { images: [], manualFields: {} },
    ]);
  });

  test('a repeat scan is blocked before any lookup runs', async () => {
    const { service, useEnrich, adapter } = createHarness();
    let lookups = 0;
    useEnrich(async (scan) => {
      lookups += 1;
      return { scan, traces: [], blocked: null };
    });
    const release = adapter.hold();
    const first = service.submit(request());
    expect((await service.submit(request())).status).toBe('duplicate');
    release();
    await first;
    expect(lookups).toBe(1);
  });

  test('an unexpected error in the steps prints without them', async () => {
    const { service, useEnrich } = createHarness();
    useEnrich(async () => {
      throw new Error('boom');
    });
    expect((await service.submit(request())).status).toBe('printed');
  });

  test('reports every recorded result with the scan it was based on, but not the test page', async () => {
    const { service, useEnrich, recorded } = createHarness();
    useEnrich(withShelf);
    await service.submit(request());
    await service.submit(request());
    await service.submit(request({ raw: '   ' }));
    await service.printTest(PRINTER, DEFAULT_PAPER);
    expect(recorded.map(({ job }) => job.status)).toEqual(['printed', 'duplicate', 'invalid']);
    expect(recorded[0]?.scan?.fields.at(-1)).toEqual({ name: '货架号', value: 'A-01' });
    expect(recorded[1]?.scan?.raw).toBe(RAW);
    expect(recorded[2]?.scan).toBeNull();
  });

  test('the test page skips the steps', async () => {
    const { service, useEnrich } = createHarness();
    useEnrich(lookupFails);
    expect((await service.printTest(PRINTER, DEFAULT_PAPER)).status).toBe('printed');
  });
});

describe('PrintService.restore', () => {
  test('rebuilds the window from recorded prints after a restart', async () => {
    const store = new InMemoryJobStore();
    const printedAt = FAKE_CLOCK_START - 60_000;
    store.append({
      id: 'old',
      createdAt: printedAt,
      raw: RAW,
      printerName: PRINTER,
      source: 'desktop',
      status: 'printed',
      forced: false,
    });
    const { service } = createHarness(store);
    service.restore();
    expect(await service.submit(request())).toMatchObject({
      status: 'duplicate',
      recent: { state: 'printed', at: printedAt },
    });
  });
});

describe('PrintService.printTest', () => {
  test('prints the test label without recording or dedup', async () => {
    const { service, adapter, store } = createHarness();
    expect((await service.printTest(PRINTER, DEFAULT_PAPER)).status).toBe('printed');
    expect((await service.printTest(PRINTER, DEFAULT_PAPER)).status).toBe('printed');
    expect(adapter.printed.map((p) => p.raw)).toEqual([TEST_RAW, TEST_RAW]);
    expect(store.listRecent(10)).toEqual([]);
  });

  test('recognises the test page like a scan, and still prints it with every rule turned off', async () => {
    const { service, useRules, useTemplate, adapter } = createHarness();
    expect(await service.printTest(PRINTER, DEFAULT_PAPER)).toMatchObject({ scan: { ruleId: DASH_THREE_RULE_ID } });
    useRules([]);
    useTemplate(GENERIC_TEMPLATE);
    expect(await service.printTest(PRINTER, DEFAULT_PAPER)).toMatchObject({
      scan: { raw: TEST_RAW, fields: [{ value: TEST_RAW }] },
    });
    expect(adapter.printed.at(-1)?.templateId).toBe(GENERIC_TEMPLATE.id);
  });

  // 测试内容填不出面单：规则绑的是面单模板时按通用标签打，纸张仍是这台打印机的。
  test('prints a generic label on the printer paper when the bound template is a waybill', async () => {
    const { service, useTemplate, adapter } = createHarness();
    useTemplate(PLATFORM_TWO_PART);
    await service.printTest(PRINTER, PLATFORM_TWO_PART.paper);
    expect(adapter.printed.at(-1)?.templateId).toBe(GENERIC_TEMPLATE.id);
  });

  test('reports test print failures', async () => {
    const { service, adapter } = createHarness();
    adapter.failNext(new PrintError('PRINTER_NOT_FOUND'));
    expect(await service.printTest(PRINTER, DEFAULT_PAPER)).toEqual({ status: 'failed', reason: 'PRINTER_NOT_FOUND' });
  });
});

describe('PrintService.printSample', () => {
  const draft: LabelTemplate = { ...PICK_TEMPLATE, id: 'custom:draft' };

  test('prints the draft with the enriched scan, without recording it or holding the dedup window', async () => {
    const { service, adapter, store, useEnrich } = createHarness();
    useEnrich(withShelf);
    expect((await service.printSample(RAW, draft)).status).toBe('printed');
    expect((await service.printSample(RAW, draft)).status).toBe('printed');
    expect(adapter.printed.map((job) => job.templateId)).toEqual(['custom:draft', 'custom:draft']);
    expect(adapter.printed[0]?.fields.at(-1)).toEqual({ name: '货架号', value: 'A-01' });
    expect(store.listRecent(10)).toEqual([]);
    expect((await service.submit(request())).status).toBe('printed');
  });

  test('reports content it cannot recognise', async () => {
    const { service, adapter } = createHarness();
    expect(await service.printSample('   ', draft)).toEqual({ status: 'invalid', reason: 'INVALID_CONTENT' });
    expect(adapter.printed).toEqual([]);
  });

  test('does not print when the paper of the draft has no printer', async () => {
    const { service, adapter, useChoice } = createHarness();
    useChoice({ printerName: null, reason: 'unassigned', paperKey: '60x40', missingPrinter: null });
    expect(await service.printSample(RAW, draft)).toEqual({
      status: 'no-printer',
      paperKey: '60x40',
      missingPrinter: null,
    });
    expect(adapter.printed).toEqual([]);
  });

  test('stops like a real print when a blocking lookup fails', async () => {
    const { service, adapter, useEnrich } = createHarness();
    useEnrich(lookupFails);
    expect(await service.printSample(RAW, draft)).toEqual({
      status: 'failed',
      reason: 'LOOKUP_FAILED',
      detail: '查询超时',
    });
    expect(adapter.printed).toEqual([]);
  });

  test('reports printer failures', async () => {
    const { service, adapter } = createHarness();
    adapter.failNext(new PrintError('PRINTER_NOT_FOUND'));
    expect(await service.printSample(RAW, draft)).toEqual({ status: 'failed', reason: 'PRINTER_NOT_FOUND' });
  });

  // 预览时按扫码结果决定的模板（这里是 PICK_TEMPLATE）和设计器正在编的草稿是两码事：
  // 选打印机要按草稿，不能按预览内部重新识别出的模板选。
  test('chooses the printer for the draft template, not the one the scan would resolve to', async () => {
    const { service, adapter, useChoosePrinter } = createHarness();
    useChoosePrinter(async (chosenTemplate) =>
      chosenTemplate.id === draft.id ? { printerName: 'A', reason: 'template' } : { printerName: 'B', reason: 'paper' },
    );
    expect((await service.printSample(RAW, draft)).status).toBe('printed');
    expect(adapter.printed[0]?.printerName).toBe('A');
  });
});

describe('PrintService printer choice', () => {
  test('prints on the printer chosen for the template and records it with the paper and template', async () => {
    const { service, adapter, store, useChoice } = createHarness();
    useChoice({ printerName: '面单机B', reason: 'paper' });
    expect((await service.submit(request())).status).toBe('printed');
    expect(adapter.printed.at(-1)).toMatchObject({ printerName: '面单机B', paper: '60x40' });
    expect(store.listRecent(1)[0]).toMatchObject({
      printerName: '面单机B',
      paper: '60x40',
      templateId: PICK_TEMPLATE.id,
    });
  });

  // 没有打印机时和 1.0.x 没选打印机一样：不打印、不写记录、不占防重复窗口。
  test('does not print, record or hold the dedup window when no printer holds the paper', async () => {
    const { service, adapter, store, useChoice } = createHarness();
    useChoice({ printerName: null, reason: 'unassigned', paperKey: '100x180', missingPrinter: null });
    expect(await service.submit(request())).toEqual({
      status: 'no-printer',
      paperKey: '100x180',
      missingPrinter: null,
    });
    expect(adapter.printed).toEqual([]);
    expect(store.listRecent(10)).toEqual([]);
    useChoice({ printerName: PRINTER, reason: 'paper' });
    expect((await service.submit(request())).status).toBe('printed');
  });

  test('resolves the template once and prints the processed scan with it', async () => {
    const { service, useEnrich, templateRequests, adapter } = createHarness();
    useEnrich(withShelf);
    await service.submit(request());
    expect(templateRequests).toHaveLength(1);
    expect(adapter.printed.at(-1)?.fields.at(-1)).toEqual({ name: '货架号', value: 'A-01' });
  });

  // 按字段换模板可以用加工步骤补出来的字段（例如 HTTP 查询回来的快递公司）：模板要在加工之后才定。
  test('chooses the template from the processed scan, so fields the steps add can switch it', async () => {
    const { service, useEnrich, templateRequests } = createHarness();
    useEnrich(withShelf);
    await service.submit(request());
    expect(templateRequests[0]?.fields.at(-1)).toEqual({ name: '货架号', value: 'A-01' });
  });

  // 重复的一张不加工：模板要是靠加工补出的字段换的，按识别结果再选一次会选错（甚至说「没有打印机」）。
  test('records a repeat with the template and printer the first print actually used', async () => {
    const { service, store, useEnrich, useResolveTemplate, useChoosePrinter } = createHarness();
    useEnrich(async (scan) => ({
      scan: { ...scan, fields: [...scan.fields, { name: '快递公司', value: '顺丰速运' }] },
      traces: [],
      blocked: null,
    }));
    useResolveTemplate((scan) => (fieldValue(scan, '快递公司') ? PLATFORM_TWO_PART : PICK_TEMPLATE));
    // 只有面单纸分配了打印机：按识别结果选出的 60×40 标签没有打印机。
    useChoosePrinter(async (template) =>
      template.id === PLATFORM_TWO_PART.id
        ? { printerName: '面单机B', reason: 'paper' }
        : { printerName: null, reason: 'unassigned', paperKey: '60x40', missingPrinter: null },
    );
    expect((await service.submit(request())).status).toBe('printed');
    expect((await service.submit(request())).status).toBe('duplicate');
    expect(store.listRecent(1)[0]).toMatchObject({
      status: 'duplicate',
      printerName: '面单机B',
      templateId: PLATFORM_TWO_PART.id,
    });
  });

  test('releases the dedup window when choosing the template fails', async () => {
    const { service, useResolveTemplate } = createHarness();
    useResolveTemplate(() => {
      throw new Error('database is locked');
    });
    await expect(service.submit(request())).rejects.toThrow('database is locked');
    useResolveTemplate(() => PICK_TEMPLATE);
    expect((await service.submit(request())).status).toBe('printed');
  });

  test('previews with the template chosen from the processed scan', async () => {
    const { service, useEnrich, templateRequests } = createHarness();
    useEnrich(withShelf);
    await service.preview(RAW);
    expect(templateRequests.at(-1)?.fields.at(-1)).toEqual({ name: '货架号', value: 'A-01' });
  });

  test('records an unrecognised scan without a printer, paper or template', async () => {
    const { service, store } = createHarness();
    await service.submit(request({ raw: '   ' }));
    const [job] = store.listRecent(1);
    expect(job?.printerName).toBe('');
    expect(job?.paper).toBeUndefined();
    expect(job?.templateId).toBeUndefined();
  });

  test('prints the test page on the paper it is given', async () => {
    const { service, adapter } = createHarness();
    await service.printTest('面单机B', { widthMm: 100, heightMm: 180 });
    expect(adapter.printed.at(-1)).toMatchObject({ printerName: '面单机B', paper: '100x180' });
  });
});

describe('PrintService job records', () => {
  test('records the fields that were printed, after the processing steps', async () => {
    const { service, useEnrich, store } = createHarness();
    useEnrich(withShelf);
    await service.submit(request());
    expect(store.listRecent(1)[0]?.fields).toEqual([...RAW_SCAN.fields, { name: '货架号', value: 'A-01' }]);
  });

  test('records who submitted the label', async () => {
    const { service, store } = createHarness();
    await service.submit(request({ caller: 'key:k1' }));
    expect(store.listRecent(1)[0]?.caller).toBe('key:k1');
  });

  test('records no fields and no caller when there are none', async () => {
    const { service, store } = createHarness();
    await service.submit(request({ raw: '   ' }));
    expect(store.listRecent(1)[0]?.fields).toBeUndefined();
    expect(store.listRecent(1)[0]?.caller).toBeUndefined();
  });
});

describe('PrintService.printFields', () => {
  const fields = [
    { name: '订单号', value: 'A001' },
    { name: '收件人', value: '张三' },
  ];
  const input = {
    template: PICK_TEMPLATE,
    fields,
    content: 'A001',
    source: 'api',
    caller: 'key:k1',
    printerName: null,
  } as const;

  test('prints the given fields with the given template, without rules or processing steps', async () => {
    const { service, adapter, store, useEnrich, useRules, templateRequests } = createHarness();
    let lookups = 0;
    useEnrich(async (scan) => {
      lookups += 1;
      return { scan, traces: [], blocked: null };
    });
    useRules([]);
    const result = await service.printFields(input);
    expect(result.status).toBe('printed');
    expect(lookups).toBe(0);
    expect(templateRequests).toEqual([]);
    expect(adapter.printed.at(-1)).toMatchObject({ raw: 'A001', templateId: PICK_TEMPLATE.id, fields });
    expect(store.listRecent(1)[0]).toMatchObject({ source: 'api', caller: 'key:k1', fields, raw: 'A001' });
  });

  test('names the local api as the rule, for the {规则} note variable and notifications', async () => {
    const { service, recorded } = createHarness();
    await service.printFields(input);
    expect(recorded.at(-1)?.scan).toMatchObject({ ruleId: 'api', ruleName: '本机接口' });
  });

  // 本机接口靠调用方的 requestId 防重复；同样的内容打两次是调用方要的。
  test('does not use the scan dedup window', async () => {
    const { service } = createHarness();
    expect((await service.printFields(input)).status).toBe('printed');
    expect((await service.printFields(input)).status).toBe('printed');
  });

  test('does not block scans of the same content', async () => {
    const { service } = createHarness();
    await service.printFields({ ...input, content: RAW });
    expect((await service.submit(request())).status).toBe('printed');
  });

  test('prints on the printer the caller names', async () => {
    const { service, adapter } = createHarness();
    await service.printFields({ ...input, printerName: '面单机B' });
    expect(adapter.printed.at(-1)?.printerName).toBe('面单机B');
  });

  test('reports no-printer like a scan and records nothing', async () => {
    const { service, store, useChoice } = createHarness();
    useChoice({ printerName: null, reason: 'unassigned', paperKey: '60x40', missingPrinter: null });
    expect(await service.printFields(input)).toEqual({ status: 'no-printer', paperKey: '60x40', missingPrinter: null });
    expect(store.listRecent(1)).toEqual([]);
  });

  test('records a failed print with its reason', async () => {
    const { service, adapter, store } = createHarness();
    adapter.failNext(new PrintError('PRINTER_NOT_READY'));
    expect(await service.printFields(input)).toMatchObject({ status: 'failed', reason: 'PRINTER_NOT_READY' });
    expect(store.listRecent(1)[0]).toMatchObject({ status: 'failed', source: 'api' });
  });
});

describe('PrintService.printFields for a batch', () => {
  const fields = [{ name: '编码', value: 'CL1' }];
  const batchInput = {
    template: PICK_TEMPLATE,
    fields,
    content: RAW,
    source: 'batch',
    caller: null,
    printerName: null,
    batch: { id: '20261002-143501-a1b2', row: 3, copy: 2 },
  } as const;

  test('records the batch, row and copy and names batch printing as the rule', async () => {
    const { service, store, recorded } = createHarness();
    expect((await service.printFields(batchInput)).status).toBe('printed');
    expect(store.listRecent(1)[0]).toMatchObject({ source: 'batch', batch: batchInput.batch, fields });
    expect(recorded.at(-1)?.scan).toMatchObject({ ruleId: 'batch', ruleName: '批量打印' });
  });

  // 批量打的内容和扫码一样时，重启后扫码不能被当成重复。
  test('stays out of the scan dedup window after a restart', async () => {
    const { service } = createHarness();
    await service.printFields(batchInput);
    service.restore();
    expect((await service.submit(request())).status).toBe('printed');
  });
});

describe('PrintService.printFields for a PDF piece', () => {
  const pdf = { file: '面单.pdf', page: 2, piece: 1, bitmap: '0f8fad5b-d9cb-469f-a165-70867728950e' };
  const pdfInput: FieldsPrint = {
    template: PICK_TEMPLATE,
    fields: [{ name: '文件', value: '面单.pdf' }],
    content: '面单.pdf 第 2 页第 1 张',
    source: 'pdf',
    caller: null,
    printerName: null,
    pdf,
  };

  test('records the piece and names PDF printing as the rule', async () => {
    const { service, store, recorded } = createHarness();
    expect((await service.printFields(pdfInput)).status).toBe('printed');
    expect(store.listRecent(1)[0]).toMatchObject({ source: 'pdf', pdf });
    expect(recorded.at(-1)?.scan).toMatchObject({ ruleId: 'pdf', ruleName: 'PDF 打印' });
  });

  test('stays out of the scan dedup window after a restart', async () => {
    const { service } = createHarness();
    await service.printFields({ ...pdfInput, content: RAW });
    service.restore();
    expect((await service.submit(request())).status).toBe('printed');
  });
});

describe('fieldsRuleFor', () => {
  test('names the rule after where the fields came from', () => {
    expect(fieldsRuleFor({})).toBe(API_RULE);
    expect(fieldsRuleFor({ batch: { id: '20261002-143501-a1b2', row: 1, copy: 1 } })).toBe(BATCH_RULE);
    expect(fieldsRuleFor({ pdf: { file: 'a.pdf', page: 1, piece: 1, bitmap: 'k' } })).toBe(PDF_RULE);
  });
});
