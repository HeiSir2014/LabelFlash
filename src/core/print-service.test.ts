import { describe, expect, test } from 'bun:test';
import { DedupGuard } from './dedup-guard';
import { PrintError } from './errors';
import { PrintQueue } from './print-queue';
import { PrintService, TEST_RAW } from './print-service';
import { BUILT_IN_RULES, DASH_THREE_RULE_ID, RAW_RULE_ID } from './scan/builtin-rules';
import { MAX_RAW_LENGTH } from './scan/normalize-raw';
import { recognize } from './scan/recognize';
import type { ScanRule } from './scan/rule-model';
import type { ScanResult } from './scan/scan-result';
import { BUILT_IN_TEMPLATES, GENERIC_TEMPLATE, STANDARD_TEMPLATE } from './templates/builtin-templates';
import type { LabelTemplate } from './templates/template-model';
import { FAKE_CLOCK_START, FakeClock } from './testing/fake-clock';
import { FakePrinterAdapter } from './testing/fake-printer-adapter';
import { InMemoryJobStore } from './testing/in-memory-job-store';
import type { PrintRequest } from './types';

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
  let template: LabelTemplate = STANDARD_TEMPLATE;
  let rules: readonly ScanRule[] = BUILT_IN_RULES;
  const templateRequests: ScanResult[] = [];
  let nextId = 0;
  const service = new PrintService({
    adapter,
    store,
    guard,
    clock,
    queue: new PrintQueue(1_000),
    createId: () => `job-${++nextId}`,
    recognize: (raw) => recognize(raw, rules, noRegex),
    resolveTemplate: (scan) => {
      templateRequests.push(scan);
      return template;
    },
  });
  const useTemplate = (next: LabelTemplate) => {
    template = next;
  };
  const useRules = (next: readonly ScanRule[]) => {
    rules = next;
  };
  return { clock, adapter, store, service, useTemplate, useRules, templateRequests };
}

function request(overrides: Partial<PrintRequest> = {}): PrintRequest {
  return { raw: RAW, printerName: PRINTER, source: 'desktop', ...overrides };
}

describe('PrintService.submit', () => {
  test('prints a recognised scan with the template resolved for it and records it', async () => {
    const { service, adapter, store, templateRequests } = createHarness();
    const result = await service.submit(request());
    expect(result).toEqual({ status: 'printed', jobId: 'job-1', scan: RAW_SCAN });
    expect(templateRequests).toEqual([RAW_SCAN]);
    expect(adapter.printed).toEqual([{ printerName: PRINTER, raw: RAW, templateId: STANDARD_TEMPLATE.id }]);
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
  test('recognises the scan and reports no recent print', () => {
    const { service } = createHarness();
    expect(service.preview(RAW)).toEqual({ status: 'ok', scan: RAW_SCAN, recent: null });
  });

  test('reports a recent print inside the window', async () => {
    const { service, clock } = createHarness();
    await service.submit(request());
    const printedAt = clock.now();
    clock.advance(30_000);
    expect(service.preview(RAW)).toMatchObject({ recent: { state: 'printed', at: printedAt } });
  });

  test('rejects blank input and content no rule recognises', () => {
    const { service, useRules } = createHarness();
    expect(service.preview('   ')).toEqual({ status: 'invalid', reason: 'INVALID_CONTENT' });
    useRules([]);
    expect(service.preview(RAW)).toEqual({ status: 'invalid', reason: 'NO_MATCHING_RULE' });
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
    expect((await service.printTest(PRINTER)).status).toBe('printed');
    expect((await service.printTest(PRINTER)).status).toBe('printed');
    expect(adapter.printed.map((p) => p.raw)).toEqual([TEST_RAW, TEST_RAW]);
    expect(store.listRecent(10)).toEqual([]);
  });

  test('recognises the test page like a scan, and still prints it with every rule turned off', async () => {
    const { service, useRules, useTemplate, adapter } = createHarness();
    expect(await service.printTest(PRINTER)).toMatchObject({ scan: { ruleId: DASH_THREE_RULE_ID } });
    useRules([]);
    useTemplate(GENERIC_TEMPLATE);
    expect(await service.printTest(PRINTER)).toMatchObject({ scan: { raw: TEST_RAW, fields: [{ value: TEST_RAW }] } });
    expect(adapter.printed.at(-1)?.templateId).toBe(GENERIC_TEMPLATE.id);
  });

  test('reports test print failures', async () => {
    const { service, adapter } = createHarness();
    adapter.failNext(new PrintError('PRINTER_NOT_FOUND'));
    expect(await service.printTest(PRINTER)).toEqual({ status: 'failed', reason: 'PRINTER_NOT_FOUND' });
  });
});
