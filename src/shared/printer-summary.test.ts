import { describe, expect, test } from 'bun:test';
import { describePrintersSummary, phonePrinterLabel } from './printer-summary';

const READY = { ready: true } as const;
const PAPER_OUT = { ready: false, detail: '缺纸', issue: 'paperOut' } as const;
const A = { name: '标签机A', isListed: true, readiness: READY };
const B = { name: '面单机B', isListed: true, readiness: READY };

describe('describePrintersSummary', () => {
  test('names a single ready printer', () => {
    expect(describePrintersSummary([A])).toEqual({ tone: 'ready', text: '标签机A · 就绪' });
  });

  test('counts several ready printers', () => {
    expect(describePrintersSummary([A, B])).toEqual({ tone: 'ready', text: '打印机 2 台就绪' });
  });

  test('names the first printer with a problem', () => {
    expect(describePrintersSummary([A, { ...B, readiness: PAPER_OUT }])).toEqual({
      tone: 'error',
      text: '面单机B（缺纸）',
    });
  });

  test('says when an assigned printer is gone from the system', () => {
    expect(describePrintersSummary([{ ...A, isListed: false, readiness: null }])).toEqual({
      tone: 'error',
      text: '标签机A（系统里找不到）',
    });
  });

  // macOS 上状态按「未知」处理：只说名字或台数，不说就绪。
  test('does not claim ready when the status is unknown', () => {
    expect(describePrintersSummary([{ ...A, readiness: null }])).toEqual({ tone: 'unknown', text: '标签机A' });
    expect(describePrintersSummary([A, { ...B, readiness: null }])).toEqual({ tone: 'unknown', text: '打印机 2 台' });
  });

  test('says when no printer is assigned', () => {
    expect(describePrintersSummary([])).toEqual({ tone: 'muted', text: '还没有分配打印机' });
  });
});

// 手机页自带「打印机：」前缀（中转服务单独部署），这里不能再带。
describe('phonePrinterLabel', () => {
  test('is the printer name, a count, or nothing', () => {
    expect(phonePrinterLabel([A])).toBe('标签机A');
    expect(phonePrinterLabel([A, { ...B, readiness: null }])).toBe('2 台');
    expect(phonePrinterLabel([A, B])).toBe('2 台就绪');
    expect(phonePrinterLabel([])).toBeNull();
  });
});
