import { describe, expect, test } from 'bun:test';
import { filterPrinters } from './list-filters';

const PRINTERS = [
  { name: '面单打印机', displayName: '面单打印机' },
  { name: 'Microsoft Print to PDF', displayName: 'Microsoft Print to PDF' },
  { name: '热敏标签机', displayName: '热敏标签机' },
];

describe('filterPrinters', () => {
  test('returns everything for a blank query', () => {
    expect(filterPrinters(PRINTERS, '  ')).toEqual(PRINTERS);
  });

  test('matches case-insensitively', () => {
    expect(filterPrinters(PRINTERS, 'pdf').map((p) => p.name)).toEqual(['Microsoft Print to PDF']);
    expect(filterPrinters(PRINTERS, '面单').map((p) => p.name)).toEqual(['面单打印机']);
  });
});
