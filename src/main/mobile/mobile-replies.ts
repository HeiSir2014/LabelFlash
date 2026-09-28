import type { PrintResult } from '../../core/types';
import type { PhonePrintResult } from '../../shared/mobile-protocol';

/** 发给手机的字段个数上限：手机上只显示摘要，多了没用，还占带宽。 */
export const PHONE_FIELD_LIMIT = 30;
/** 每个字段名和值的长度上限：HTTP 查询回来的值可能很长。 */
export const PHONE_VALUE_LIMIT = 300;

/** PrintService 的结果 → 发给手机的精简结果：只带手机要显示的，不带原文以外的内部信息。 */
export function toPhonePrintResult(result: PrintResult): PhonePrintResult {
  switch (result.status) {
    case 'printed':
      return {
        status: 'printed',
        ruleName: result.scan.ruleName.slice(0, PHONE_VALUE_LIMIT),
        fields: result.scan.fields.slice(0, PHONE_FIELD_LIMIT).map((field) => ({
          name: field.name.slice(0, PHONE_VALUE_LIMIT),
          value: field.value.slice(0, PHONE_VALUE_LIMIT),
        })),
      };
    case 'duplicate':
      return { status: 'duplicate', recent: result.recent, windowMs: result.windowMs };
    case 'invalid':
      return { status: 'invalid', reason: result.reason };
    case 'failed':
      return { status: 'failed', reason: result.reason, detail: result.detail ?? null, issue: result.issue ?? null };
  }
}
