import { describe, expect, test } from 'bun:test';
import { type PrinterReadiness, PrinterStatusMonitor, parsePrinterStatus } from './printer-status';

describe('parsePrinterStatus', () => {
  test('treats Normal and busy states as ready', () => {
    expect(parsePrinterStatus('Normal\r\n')).toEqual({ ready: true });
    expect(parsePrinterStatus('Printing')).toEqual({ ready: true });
  });

  test('reports not-ready states in Chinese, including combined flags', () => {
    expect(parsePrinterStatus('Offline')).toEqual({ ready: false, detail: '打印机离线' });
    expect(parsePrinterStatus('Offline, PaperOut')).toEqual({ ready: false, detail: '打印机离线、缺纸' });
  });
});

describe('PrinterStatusMonitor', () => {
  test('caches the watched printer and forgets it when switching', async () => {
    const answers = new Map<string, PrinterReadiness | null>([
      ['A', { ready: false, detail: '缺纸' }],
      ['B', null],
    ]);
    const monitor = new PrinterStatusMonitor(async (name) => answers.get(name) ?? null);
    await monitor.watch('A');
    expect(monitor.get('A')).toEqual({ ready: false, detail: '缺纸' });
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
    release({ ready: false, detail: '卡纸' });
    await pending;
    expect(monitor.get('A')).toBeNull();
    expect(monitor.get('B')).toEqual({ ready: true });
  });
});
