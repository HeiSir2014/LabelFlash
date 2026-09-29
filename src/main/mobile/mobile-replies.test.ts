import { describe, expect, test } from 'bun:test';
import type { PrintResult } from '../../core/types';
import { randomId } from '../../shared/mobile-crypto';
import { type DesktopMessage, MAX_MESSAGE_BYTES } from '../../shared/mobile-protocol';
import { PHONE_FIELD_LIMIT, PHONE_TEXT_LIMIT, toPhonePrintResult } from './mobile-replies';

const scan = {
  raw: 'CL5640-TK-图片色-XL',
  ruleId: 'builtin:dash',
  ruleName: '横杠三段',
  fields: [
    { name: '编码', value: 'CL5640' },
    { name: '颜色', value: '图片色' },
  ],
};

/** 控制字符在 JSON 里转义成 \u0001 这样的 6 个字节，是最坏情况。 */
const WORST_CHARACTER = String.fromCharCode(1);

function messageBytes(message: DesktopMessage): number {
  return new TextEncoder().encode(JSON.stringify(message)).length;
}

describe('toPhonePrintResult', () => {
  test('tells the phone there is no printer for this paper', () => {
    expect(toPhonePrintResult({ status: 'no-printer', paperKey: '100x180', missingPrinter: null })).toEqual({
      status: 'no-printer',
    });
  });

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
      value: 'x'.repeat(PHONE_TEXT_LIMIT + 10),
    }));
    const result = toPhonePrintResult({ status: 'printed', jobId: 'j1', scan: { ...scan, fields } });
    if (result.status !== 'printed') {
      throw new Error('expected printed');
    }
    expect(result.fields).toHaveLength(PHONE_FIELD_LIMIT);
    expect(result.fields[0]?.value).toHaveLength(PHONE_TEXT_LIMIT);
  });

  test('keeps the largest printed result within one message', () => {
    const worst = WORST_CHARACTER.repeat(PHONE_TEXT_LIMIT * 2);
    const fields = Array.from({ length: PHONE_FIELD_LIMIT * 2 }, () => ({ name: worst, value: worst }));
    const result = toPhonePrintResult({
      status: 'printed',
      jobId: 'j1',
      scan: { ...scan, ruleName: worst, fields },
    });
    expect(messageBytes({ type: 'result', job: randomId(), result })).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
  });

  test('keeps the largest failure within one message', () => {
    const detail = WORST_CHARACTER.repeat(MAX_MESSAGE_BYTES);
    const result = toPhonePrintResult({ status: 'failed', reason: 'LOOKUP_FAILED', detail });
    expect(messageBytes({ type: 'result', job: randomId(), result })).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
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
      field: null,
    });
    expect(
      toPhonePrintResult({ status: 'failed', reason: 'PRINTER_NOT_READY', detail: '打印机缺纸', issue: 'paperOut' }),
    ).toEqual({ status: 'failed', reason: 'PRINTER_NOT_READY', detail: '打印机缺纸', issue: 'paperOut', field: null });
  });

  test('names the field that could not be read so the phone can ask for it', () => {
    expect(
      toPhonePrintResult({ status: 'failed', reason: 'TEXT_NOT_FOUND', detail: '没认出货架号', field: '货架号' }),
    ).toEqual({ status: 'failed', reason: 'TEXT_NOT_FOUND', detail: '没认出货架号', issue: null, field: '货架号' });
  });
});
