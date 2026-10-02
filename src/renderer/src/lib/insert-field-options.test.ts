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
