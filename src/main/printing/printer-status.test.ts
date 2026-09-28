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
  test('caches the watched printer and forgets it when switching', async () => {
    const answers = new Map<string, PrinterReadiness | null>([
      ['A', PAPER_OUT],
      ['B', null],
    ]);
    const monitor = new PrinterStatusMonitor(async (name) => answers.get(name) ?? null);
    await monitor.watch('A');
    expect(monitor.get('A')).toEqual(PAPER_OUT);
    await monitor.watch('B');
    expect(monitor.get('A')).toBeNull();
    expect(monitor.get('B')).toBeNull();
  });

  test('drops a stale answer when the watched printer changed during the probe', async () => {
    let release: (value: PrinterReadiness) => void = () => {};
    const monitor = new PrinterStatusMonitor((name) =>
      name === 'A' ? new Promise<PrinterReadiness>((resolve) => (release = resolve)) : Promise.resolve({ ready: true }),
    );
    const pending = monitor.watch('A');
    await monitor.watch('B');
    release(PAPER_JAM);
    await pending;
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
    await monitor.watch('A');
    for (let i = 0; i < 5; i += 1) {
      await monitor.poll();
    }
    expect(alerts).toEqual(['A:缺纸', 'A:卡纸', 'A:缺纸']);
  });
});
