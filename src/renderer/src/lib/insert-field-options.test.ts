import { describe, expect, test } from 'bun:test';
import { INSERT_FIELD_PLACEHOLDER, insertFieldOptions } from './insert-field-options';

describe('insertFieldOptions', () => {
  test('starts with the placeholder, then field names, then the fixed variables', () => {
    const options = insertFieldOptions(['商品码', '尺码']);
    expect(options[0]).toEqual({ value: INSERT_FIELD_PLACEHOLDER, label: '插入字段…' });
    expect(options.slice(1, 3)).toEqual([
      { value: '{商品码}', label: '商品码' },
      { value: '{尺码}', label: '尺码' },
    ]);
    expect(options.slice(3)).toEqual([
      { value: '{完整内容}', label: '完整内容' },
      { value: '{规则}', label: '规则' },
      { value: '{日期}', label: '日期' },
      { value: '{时间}', label: '时间' },
    ]);
  });

  test('de-duplicates repeated field names instead of listing the same option twice', () => {
    const options = insertFieldOptions(['尺码', '尺码', '商品码']);
    expect(options.map((option) => option.label)).toEqual([
      '插入字段…',
      '尺码',
      '商品码',
      '完整内容',
      '规则',
      '日期',
      '时间',
    ]);
  });

  test('drops a fixed variable that collides with a field name instead of listing it twice', () => {
    const options = insertFieldOptions(['日期']);
    expect(options.map((option) => option.label)).toEqual(['插入字段…', '日期', '完整内容', '规则', '时间']);
  });

  describe('with the current sample content', () => {
    const sample = {
      raw: 'CL5640-TK-图片色-XL',
      ruleId: 'builtin:dash-three',
      ruleName: '横杠三段',
      fields: [
        { name: '编码', value: 'CL5640-TK' },
        { name: '尺码', value: 'XL' },
        { name: '颜色', value: '' },
      ],
    };

    test('shows what each field holds in this sample', () => {
      const options = insertFieldOptions(['编码', '尺码'], sample);
      expect(options.slice(1, 3)).toEqual([
        { value: '{编码}', label: '编码 — CL5640-TK' },
        { value: '{尺码}', label: '尺码 — XL' },
      ]);
    });

    test('says when a field is not in this sample, including an empty one', () => {
      const labels = insertFieldOptions(['货架号', '颜色'], sample).map((option) => option.label);
      expect(labels).toContain('货架号（这段内容里没有）');
      expect(labels).toContain('颜色（这段内容里没有）');
    });

    test('also lists fields that only this sample recognised, and the values of the full content and the rule', () => {
      const labels = insertFieldOptions([], sample).map((option) => option.label);
      expect(labels.slice(1, 3)).toEqual(['编码 — CL5640-TK', '尺码 — XL']);
      expect(labels).toContain('完整内容 — CL5640-TK-图片色-XL');
      expect(labels).toContain('规则 — 横杠三段');
      expect(labels).toContain('日期');
    });

    test('cuts a long value and shows line breaks as ⏎', () => {
      const long = { ...sample, fields: [{ name: '备注', value: '第一行\n第二行很长很长很长很长很长很长' }] };
      const label = insertFieldOptions(['备注'], long)[1]?.label ?? '';
      expect(label.startsWith('备注 — 第一行⏎第二行')).toBe(true);
      expect(label.endsWith('…')).toBe(true);
    });
  });

  test('has only the placeholder and the fixed variables when there are no field names', () => {
    expect(insertFieldOptions([]).map((option) => option.label)).toEqual([
      '插入字段…',
      '完整内容',
      '规则',
      '日期',
      '时间',
    ]);
  });
});
