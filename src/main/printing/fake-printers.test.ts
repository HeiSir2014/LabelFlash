import { describe, expect, test } from 'bun:test';
import { GENERIC_TEMPLATE } from '../../core/templates/builtin-templates';
import type { LabelJob } from '../../core/types';
import {
  FAKE_PRINTERS_ENV,
  FakeDriverAdapter,
  type FakePrinterSpec,
  FakePrinters,
  parseFakePrinters,
} from './fake-printers';

const SPEC: FakePrinterSpec[] = [
  { name: '标签机A', paper: { widthMm: 60, heightMm: 40, dpi: 203 }, readiness: { ready: true } },
  { name: '面单机B', paper: { widthMm: 100, heightMm: 180, dpi: 203 }, readiness: null },
];
const JOB: LabelJob = {
  scan: { raw: 'X', ruleId: 'r', ruleName: 'r', fields: [] },
  template: GENERIC_TEMPLATE,
  printedAt: 0,
};

describe('parseFakePrinters', () => {
  test('is off for a packaged app or without the variable', () => {
    expect(parseFakePrinters({ [FAKE_PRINTERS_ENV]: JSON.stringify(SPEC) }, true)).toBeNull();
    expect(parseFakePrinters({}, false)).toBeNull();
  });

  test('reads the printers from the variable', () => {
    expect(parseFakePrinters({ [FAKE_PRINTERS_ENV]: JSON.stringify(SPEC) }, false)).toEqual(SPEC);
  });

  test('fails loudly on a malformed value', () => {
    expect(() => parseFakePrinters({ [FAKE_PRINTERS_ENV]: '[{"name":1}]' }, false)).toThrow(FAKE_PRINTERS_ENV);
  });
});

describe('FakePrinters', () => {
  test('lists, describes and records prints without touching real printers', async () => {
    const printers = new FakePrinters(SPEC);
    expect((await printers.listPrinters()).map((printer) => printer.name)).toEqual(['标签机A', '面单机B']);
    expect(await printers.driverPaper('面单机B')).toEqual({ widthMm: 100, heightMm: 180, dpi: 203 });
    expect(await printers.readiness('标签机A')).toEqual({ ready: true });
    await printers.print('面单机B', JOB, new AbortController().signal);
    expect(printers.printed).toEqual([
      { printerName: '面单机B', raw: 'X', paper: '60x40', templateId: GENERIC_TEMPLATE.id },
    ]);
  });

  test('reports an unknown printer as not found', async () => {
    const printers = new FakePrinters(SPEC);
    await expect(printers.print('没有这台', JOB, new AbortController().signal)).rejects.toMatchObject({
      reason: 'PRINTER_NOT_FOUND',
    });
  });

  // E2E 测暂停、取消：每张要花一点时间，按钮才点得到正在打的批次。
  test('takes the configured time for each print', async () => {
    const printers = new FakePrinters([{ ...SPEC[0], name: '慢标签机', printDelayMs: 50 } as FakePrinterSpec]);
    const started = performance.now();
    await printers.print('慢标签机', JOB, new AbortController().signal);
    expect(performance.now() - started).toBeGreaterThanOrEqual(45);
    expect(printers.printed).toHaveLength(1);
  });
});

describe('FakePrinters (printer commands)', () => {
  test('reports the driver name and records raw commands as text', async () => {
    const printers = new FakePrinters([
      { ...SPEC[0], name: '标签机A', driverName: 'Label Printer TSPL' } as FakePrinterSpec,
    ]);
    expect(await printers.driverName('标签机A')).toBe('Label Printer TSPL');
    expect(await printers.driverName('没有这台')).toBeNull();
    expect(await printers.sendRaw('标签机A', Buffer.from('FORMFEED\r\n'))).toEqual({ ok: true });
    expect(printers.rawJobs).toEqual([{ printerName: '标签机A', text: 'FORMFEED\r\n' }]);
  });

  test('fails raw commands the way the spec says and records nothing', async () => {
    const printers = new FakePrinters([{ ...SPEC[0], name: '面单机B', rawFailure: 'raw-rejected' } as FakePrinterSpec]);
    expect(await printers.sendRaw('面单机B', Buffer.from('~PH\n'))).toMatchObject({
      ok: false,
      failure: { kind: 'raw-rejected' },
    });
    expect(await printers.sendRaw('没有这台', Buffer.from('~PH\n'))).toMatchObject({
      ok: false,
      failure: { kind: 'not-found' },
    });
    expect(printers.rawJobs).toEqual([]);
  });
});

describe('FakeDriverAdapter', () => {
  test('answers the questions the main process asks a printer driver', async () => {
    const adapter = new FakeDriverAdapter(new FakePrinters(SPEC));
    expect(await adapter.knownPrinterNames()).toEqual(['标签机A', '面单机B']);
    expect(await adapter.hasPrinter('面单机B')).toBe(true);
    expect(await adapter.hasPrinter('没有这台')).toBe(false);
  });

  // 假打印机说自己缺纸时，打印和真的适配器一样被拦下。
  test('refuses to print on a fake printer that is not ready', async () => {
    const adapter = new FakeDriverAdapter(
      new FakePrinters([
        { name: '缺纸机', paper: null, readiness: { ready: false, detail: '缺纸', issue: 'paperOut' } },
      ]),
    );
    await expect(adapter.print('缺纸机', JOB, new AbortController().signal)).rejects.toMatchObject({
      reason: 'PRINTER_NOT_READY',
    });
  });
});
