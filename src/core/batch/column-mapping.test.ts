import { describe, expect, test } from 'bun:test';
import { autoMapping, mappableVariables, unmappedVariables, usesSerial } from './column-mapping';

describe('autoMapping', () => {
  test('maps a variable to the column with the same name', () => {
    expect(autoMapping(['编码', '颜色'], ['颜色', '编码'])).toEqual({
      编码: { kind: 'column', column: '编码' },
      颜色: { kind: 'column', column: '颜色' },
    });
  });

  test('ignores spaces, full-width letters and case when there is no exact match', () => {
    expect(autoMapping(['编码', 'sku'], ['编 码', 'ＳＫＵ'])).toEqual({
      编码: { kind: 'column', column: '编 码' },
      sku: { kind: 'column', column: 'ＳＫＵ' },
    });
  });

  test('leaves a variable without a matching column unmapped', () => {
    expect(autoMapping(['货架号'], ['编码'])).toEqual({ 货架号: { kind: 'none' } });
  });
});

describe('template variables', () => {
  test('maps every variable except the serial, which has its own settings', () => {
    expect(mappableVariables({ mode: 'PICKED', names: ['编码', '序号', '颜色'] })).toEqual(['编码', '颜色']);
    expect(usesSerial({ mode: 'PICKED', names: ['编码', '序号'] })).toBe(true);
    expect(usesSerial({ mode: 'ALL', names: [] })).toBe(false);
  });

  test('lists variables that are not mapped or whose column is gone', () => {
    const mapping = {
      编码: { kind: 'column', column: '编码' },
      颜色: { kind: 'column', column: '旧列' },
      尺码: { kind: 'none' },
      备注: { kind: 'fixed', value: '' },
    } as const;
    expect(unmappedVariables(mapping, ['编码', '颜色', '尺码', '备注'], ['编码'])).toEqual(['颜色', '尺码']);
  });
});
