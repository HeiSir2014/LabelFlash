import { describe, expect, test } from 'bun:test';
import type { ScanResult } from '../scan/scan-result';
import { GENERIC_TEMPLATE, STANDARD_TEMPLATE } from './builtin-templates';
import { bottomText, resolveFields, resolveQrText } from './label-content';
import { type LabelTemplate, TEMPLATE_LIMITS } from './template-model';

const GARMENT: ScanResult = {
  raw: 'CL5640-TK-图片色-XL',
  ruleId: 'builtin:dash-three',
  ruleName: '横杠三段（编码-颜色-尺码）',
  fields: [
    { name: '编码', value: 'CL5640-TK' },
    { name: '颜色', value: '图片色' },
    { name: '尺码', value: 'XL' },
  ],
};

const ORDER: ScanResult = {
  raw: '202609280001',
  ruleId: 'builtin:digits-order',
  ruleName: '纯数字订单号',
  fields: [{ name: '订单号', value: '202609280001' }],
};

const MULTI_LINE: ScanResult = {
  raw: '订单号：A001\n款号：CL5640\n\n颜色：黑',
  ruleId: 'builtin:key-value',
  ruleName: '多行键值',
  fields: [
    { name: '订单号', value: 'A001' },
    { name: '款号', value: 'CL5640' },
    { name: '颜色', value: '黑' },
  ],
};

const PRINTED_AT = new Date(2026, 8, 28, 9, 5);

function resolveFieldRows(template: LabelTemplate, scan: ScanResult) {
  return resolveFields(template, scan).rows;
}

function withQr(content: LabelTemplate['qr']['content']): LabelTemplate {
  return { ...GENERIC_TEMPLATE, qr: { ...GENERIC_TEMPLATE.qr, content } };
}

describe('resolveFieldRows', () => {
  test('the generic template lists every field as 名称：值 in recognition order', () => {
    expect(resolveFieldRows(GENERIC_TEMPLATE, MULTI_LINE).map((row) => [row.prefix, row.value])).toEqual([
      ['订单号：', 'A001'],
      ['款号：', 'CL5640'],
      ['颜色：', '黑'],
    ]);
  });

  test('skips empty fields, such as a lookup that found nothing', () => {
    const scan: ScanResult = { ...ORDER, fields: [...ORDER.fields, { name: '货架号', value: '' }] };
    expect(resolveFieldRows(GENERIC_TEMPLATE, scan).map((row) => row.value)).toEqual(['202609280001']);
  });

  test('hides the names when the template says so', () => {
    const template: LabelTemplate = {
      ...GENERIC_TEMPLATE,
      fieldsArea: { ...GENERIC_TEMPLATE.fieldsArea, all: { ...GENERIC_TEMPLATE.fieldsArea.all, showNames: false } },
    };
    expect(resolveFieldRows(template, ORDER)).toEqual([
      { prefix: '', value: '202609280001', style: { fontSizeMm: 3, bold: true } },
    ]);
  });

  test('the garment template shows only the picked fields, with their own prefixes and styles', () => {
    const rows = resolveFieldRows(STANDARD_TEMPLATE, {
      ...GARMENT,
      fields: [...GARMENT.fields, { name: '库位', value: 'A-01' }],
    });
    expect(rows.map((row) => `${row.prefix}${row.value}`)).toEqual(['编码：CL5640-TK', '颜色：图片色', '尺码：XL']);
    expect(rows[0]?.style).toMatchObject({ fontSizeMm: 3.2, bold: true });
  });

  test('skips picked fields that were not recognised', () => {
    const scan: ScanResult = { ...GARMENT, fields: [{ name: '尺码', value: 'XL' }] };
    expect(resolveFieldRows(STANDARD_TEMPLATE, scan).map((row) => row.value)).toEqual(['XL']);
  });

  test('falls back to every field when none of the picked fields was recognised', () => {
    const fields = resolveFields(STANDARD_TEMPLATE, ORDER);
    expect(fields.rows.map((row) => [row.prefix, row.value])).toEqual([['订单号：', '202609280001']]);
    expect(fields.isAllFields).toBe(true);
    expect(resolveFields(STANDARD_TEMPLATE, GARMENT).isAllFields).toBe(false);
  });

  test('joins each name with the separator of the template', () => {
    const template: LabelTemplate = {
      ...GENERIC_TEMPLATE,
      fieldsArea: { ...GENERIC_TEMPLATE.fieldsArea, all: { ...GENERIC_TEMPLATE.fieldsArea.all, separator: ':' } },
    };
    expect(resolveFieldRows(template, ORDER)[0]?.prefix).toBe('订单号:');
  });

  test('shows at most six rows and sums up the rest', () => {
    const fields = Array.from({ length: 9 }, (_, index) => ({ name: `字段${index + 1}`, value: `${index + 1}` }));
    const rows = resolveFieldRows(GENERIC_TEMPLATE, { ...MULTI_LINE, fields });
    expect(rows).toHaveLength(TEMPLATE_LIMITS.allFieldRows);
    expect(rows.at(-2)?.value).toBe('5');
    expect(rows.at(-1)).toMatchObject({ prefix: '', value: '…等 4 项' });
  });
});

describe('resolveQrText', () => {
  test('encodes the full content by default', () => {
    expect(resolveQrText(GENERIC_TEMPLATE, MULTI_LINE, PRINTED_AT)).toBe(MULTI_LINE.raw);
  });

  test('encodes one field, falling back to the full content when it was not recognised', () => {
    expect(resolveQrText(withQr({ kind: 'field', field: '订单号' }), MULTI_LINE, PRINTED_AT)).toBe('A001');
    expect(resolveQrText(withQr({ kind: 'field', field: '订单号' }), GARMENT, PRINTED_AT)).toBe(GARMENT.raw);
  });

  test('encodes text with variables, falling back to the full content when it comes out empty', () => {
    const link = withQr({ kind: 'text', text: 'https://example.com/o/{订单号}' });
    expect(resolveQrText(link, MULTI_LINE, PRINTED_AT)).toBe('https://example.com/o/A001');
    expect(resolveQrText(withQr({ kind: 'text', text: '   ' }), ORDER, PRINTED_AT)).toBe(ORDER.raw);
  });
});

describe('bottomText', () => {
  test('joins multi-line content with slashes and drops blank lines', () => {
    expect(bottomText(MULTI_LINE)).toBe('订单号：A001 / 款号：CL5640 / 颜色：黑');
  });

  test('is hidden when the only field already is the full content', () => {
    expect(bottomText(ORDER)).toBeNull();
  });

  test('shows the full code for split content', () => {
    expect(bottomText(GARMENT)).toBe(GARMENT.raw);
  });
});
