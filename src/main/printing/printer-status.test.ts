import { describe, expect, test } from 'bun:test';
import { type PrinterReadiness, PrinterStatusMonitor, parsePrinterStatus } from './printer-status';

const PAPER_OUT: PrinterReadiness = { ready: false, detail: '缺纸', issue: 'paperOut' };
const PAPER_JAM: PrinterReadiness = { ready: false, detail: '卡纸', issue: 'paperJam' };

describe('parsePrinterStatus', () => {
  test('treats Normal and busy states as ready', () => {
    expect(parsePrinterStatus('Normal\r\n')).toEqual({ ready: true });
    expect(parsePrinterStatus('Printing')).toEqual({ ready: true });
  });

  test('reports not-ready states in Chinese, including combined flags', () => {
    expect(parsePrinterStatus('Offline')).toEqual({ ready: false, detail: '打印机离线', issue: 'offline' });
    expect(parsePrinterStatus('Offline, PaperOut')).toEqual({
      ready: false,
      detail: '打印机离线、缺纸',
      issue: 'paperOut',
    });
  });

  test('classifies the issue the operator has to fix first', () => {
    expect(parsePrinterStatus('PaperJam')).toMatchObject({ issue: 'paperJam' });
    expect(parsePrinterStatus('Offline, DoorOpen')).toMatchObject({ issue: 'doorOpen' });
    expect(parsePrinterStatus('PaperProblem')).toMatchObject({ issue: 'paperOut' });
    expect(parsePrinterStatus('NotAvailable')).toMatchObject({ issue: 'offline' });
    expect(parsePrinterStatus('UserIntervention')).toMatchObject({ issue: 'other' });
  });
});

describe('PrinterStatusMonitor', () => {
  test('caches the watched printers and forgets one that is no longer watched', async () => {
    const answers = new Map<string, PrinterReadiness | null>([
      ['A', PAPER_OUT],
      ['B', null],
    ]);
    let names = ['A'];
    const monitor = new PrinterStatusMonitor(async (name) => answers.get(name) ?? null);
    await monitor.watchPrinters(() => names);
    expect(monitor.get('A')).toEqual(PAPER_OUT);
    names = ['B'];
    await monitor.poll();
    expect(monitor.get('A')).toBeNull();
    expect(monitor.get('B')).toBeNull();
  });

  test('drops a stale answer when the printer stopped being watched during the probe', async () => {
    let release: (value: PrinterReadiness) => void = () => {};
    let names = ['A'];
    const monitor = new PrinterStatusMonitor((name) =>
      name === 'A' ? new Promise<PrinterReadiness>((resolve) => (release = resolve)) : Promise.resolve({ ready: true }),
    );
    const pending = monitor.watchPrinters(() => names);
    names = ['B'];
    release(PAPER_JAM);
    await pending;
    await monitor.poll();
    expect(monitor.get('A')).toBeNull();
    expect(monitor.get('B')).toEqual({ ready: true });
  });

  test('reports a printer becoming not ready once per change, not on every poll', async () => {
    const answers: Array<PrinterReadiness | null> = [
      { ready: true },
      PAPER_OUT,
      PAPER_OUT,
      PAPER_JAM,
      { ready: true },
      PAPER_OUT,
    ];
    const alerts: string[] = [];
    const monitor = new PrinterStatusMonitor(
      async () => answers.shift() ?? null,
      (name, detail) => alerts.push(`${name}:${detail}`),
    );
    await monitor.watchPrinters(() => ['A']);
    for (let i = 0; i < 5; i += 1) {
      await monitor.poll();
    }
    expect(alerts).toEqual(['A:缺纸', 'A:卡纸', 'A:缺纸']);
  });

  test('checks every watched printer and reports each one that stops being ready', async () => {
    const answers = new Map<string, PrinterReadiness | null>([
      ['A', { ready: true }],
      ['B', PAPER_OUT],
    ]);
    const notified: string[] = [];
    const monitor = new PrinterStatusMonitor(
      async (name) => answers.get(name) ?? null,
      (name, detail) => notified.push(`${name}:${detail}`),
    );
    await monitor.watchPrinters(() => ['A', 'B']);
    expect(monitor.get('A')).toEqual({ ready: true });
    expect(monitor.get('B')).toEqual(PAPER_OUT);
    expect(notified).toEqual(['B:缺纸']);
  });

  // 设置保存时会重新检测一次：还在检测的打印机不能因此再报一次同样的问题。
  test('does not report the same problem again after the watch list changes', async () => {
    const notified: string[] = [];
    let names = ['B'];
    const monitor = new PrinterStatusMonitor(
      async () => PAPER_OUT,
      (name) => notified.push(name),
    );
    await monitor.watchPrinters(() => names);
    names = ['B', 'C'];
    await monitor.poll();
    expect(notified).toEqual(['B', 'C']);
  });

  // 正在检测时又要求检测（设置保存、窗口刚建好）：这一轮完了再补一轮，不丢掉这次请求。
  test('runs one more poll after the current one when asked during a poll', async () => {
    let probes = 0;
    let release: () => void = () => {};
    const monitor = new PrinterStatusMonitor(() => {
      probes += 1;
      return probes === 1
        ? new Promise((resolve) => (release = () => resolve({ ready: true })))
        : Promise.resolve({ ready: true });
    });
    const first = monitor.watchPrinters(() => ['A']);
    const second = monitor.poll();
    // 不叠加：上一轮没查完时不开始新的查询。
    expect(probes).toBe(1);
    release();
    await first;
    await second;
    expect(probes).toBe(2);
  });
});
