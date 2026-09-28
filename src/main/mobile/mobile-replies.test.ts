import { describe, expect, test } from 'bun:test';
import type { PrintResult } from '../../core/types';
import { PHONE_FIELD_LIMIT, PHONE_VALUE_LIMIT, toPhonePrintResult } from './mobile-replies';

const scan = {
  raw: 'CL5640-TK-图片色-XL',
  ruleId: 'builtin:dash',
  ruleName: '横杠三段',
  fields: [
    { name: '编码', value: 'CL5640' },
    { name: '颜色', value: '图片色' },
  ],
};

describe('toPhonePrintResult', () => {
  test('sends the rule and fields of a printed label, without the rest of the scan', () => {
    expect(toPhonePrintResult({ status: 'printed', jobId: 'j1', scan })).toEqual({
      status: 'printed',
      ruleName: '横杠三段',
      fields: scan.fields,
    });
  });

  test('trims a long field list and long values', () => {
    const fields = Array.from({ length: PHONE_FIELD_LIMIT + 5 }, (_, index) => ({
      name: `字段${index}`,
      value: 'x'.repeat(PHONE_VALUE_LIMIT + 10),
    }));
    const result = toPhonePrintResult({ status: 'printed', jobId: 'j1', scan: { ...scan, fields } });
    if (result.status !== 'printed') {
      throw new Error('expected printed');
    }
    expect(result.fields).toHaveLength(PHONE_FIELD_LIMIT);
    expect(result.fields[0]?.value).toHaveLength(PHONE_VALUE_LIMIT);
  });

  test('passes duplicates and unreadable content through', () => {
    const duplicate: PrintResult = { status: 'duplicate', recent: { state: 'printed', at: 5 }, windowMs: 3_000 };
    expect(toPhonePrintResult(duplicate)).toEqual(duplicate);
    expect(toPhonePrintResult({ status: 'invalid', reason: 'NO_MATCHING_RULE' })).toEqual({
      status: 'invalid',
      reason: 'NO_MATCHING_RULE',
    });
  });

  test('fills in missing failure details as null', () => {
    expect(toPhonePrintResult({ status: 'failed', reason: 'PRINT_TIMEOUT' })).toEqual({
      status: 'failed',
      reason: 'PRINT_TIMEOUT',
      detail: null,
      issue: null,
    });
    expect(
      toPhonePrintResult({ status: 'failed', reason: 'PRINTER_NOT_READY', detail: '打印机缺纸', issue: 'paperOut' }),
    ).toEqual({ status: 'failed', reason: 'PRINTER_NOT_READY', detail: '打印机缺纸', issue: 'paperOut' });
  });
});
