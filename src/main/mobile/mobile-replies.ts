import type { PrintResult } from '../../core/types';
import { clipText, type PhonePrintResult } from '../../shared/mobile-protocol';

/** 发给手机的字段个数上限：手机上只把前几个字段的值列成一行摘要，多了没用，还占带宽。 */
export const PHONE_FIELD_LIMIT = 10;
/**
 * 规则名、字段名、字段值、失败说明的长度上限（字符）：HTTP 查询回来的值可能很长。
 * 和 PHONE_FIELD_LIMIT 一起保证最坏情况下结果消息也不超过 MAX_MESSAGE_BYTES（见测试）。
 */
export const PHONE_TEXT_LIMIT = 200;

/** PrintService 的结果 → 发给手机的精简结果：只带手机要显示的，不带原文以外的内部信息。 */
export function toPhonePrintResult(result: PrintResult): PhonePrintResult {
  switch (result.status) {
    case 'printed':
      return {
        status: 'printed',
        ruleName: clip(result.scan.ruleName),
        fields: result.scan.fields.slice(0, PHONE_FIELD_LIMIT).map((field) => ({
          name: clip(field.name),
          value: clip(field.value),
        })),
      };
    case 'duplicate':
      return { status: 'duplicate', recent: result.recent, windowMs: result.windowMs };
    case 'invalid':
      return { status: 'invalid', reason: result.reason };
    case 'no-printer':
      return { status: 'no-printer' };
    case 'failed':
      return {
        status: 'failed',
        reason: result.reason,
        detail: result.detail === undefined ? null : clip(result.detail),
        issue: result.issue ?? null,
      };
  }
}

function clip(text: string): string {
  return clipText(text, PHONE_TEXT_LIMIT);
}
