import { describe, expect, test } from 'bun:test';
import { MAX_RAW_LENGTH } from '../scan/normalize-raw';
import { contentOf } from './api-model';

describe('contentOf', () => {
  test('uses the content the caller gave', () => {
    expect(contentOf({ fields: [{ name: '订单号', value: 'A001' }], content: 'SF123' })).toBe('SF123');
  });

  test('joins the fields one per line when there is no content', () => {
    expect(
      contentOf({
        fields: [
          { name: '订单号', value: 'A001' },
          { name: '收件人', value: '张三' },
        ],
        content: null,
      }),
    ).toBe('订单号：A001\n收件人：张三');
  });

  // 打印记录的内容和扫码一样最长 1000 个字（全文搜索、列表显示都按这个上限设计）。
  test('keeps joined content within the length of scanned content', () => {
    const fields = [
      { name: 'a', value: 'x'.repeat(MAX_RAW_LENGTH) },
      { name: 'b', value: 'y' },
    ];
    expect(contentOf({ fields, content: null })).toHaveLength(MAX_RAW_LENGTH);
  });
});
