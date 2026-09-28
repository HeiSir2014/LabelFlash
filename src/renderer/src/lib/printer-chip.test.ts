import { describe, expect, test } from 'bun:test';
import { describePrinterChip } from './printer-chip';

const base = { printerName: '热敏标签机', isLoading: false, isListed: true, readiness: null };

describe('describePrinterChip', () => {
  test('no printer selected', () => {
    expect(describePrinterChip({ ...base, printerName: null })).toEqual({ tone: 'muted', text: '未选择打印机' });
  });

  test('does not flag a saved printer as missing while the list is loading', () => {
    expect(describePrinterChip({ ...base, isListed: false, isLoading: true }).tone).toBe('muted');
    expect(describePrinterChip({ ...base, isListed: false }).tone).toBe('error');
  });

  test('shows readiness from the status monitor', () => {
    expect(describePrinterChip(base)).toEqual({ tone: 'unknown', text: '热敏标签机' });
    expect(describePrinterChip({ ...base, readiness: { ready: true } }).tone).toBe('ready');
    expect(describePrinterChip({ ...base, readiness: { ready: false, detail: '缺纸' } })).toEqual({
      tone: 'error',
      text: '热敏标签机（缺纸）',
    });
  });
});
