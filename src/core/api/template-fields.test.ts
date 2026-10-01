import { describe, expect, test } from 'bun:test';
import { DEPPON_TWO_PART, PLATFORM_TWO_PART } from '../templates/builtin-waybills';
import type { QrLabelTemplate } from '../templates/template-model';
import { PICK_TEMPLATE } from '../testing/templates';
import { templateFields } from './template-fields';

const SLOT = { prefix: '', fontSizeMm: 3, bold: false };

function withParts(parts: Partial<QrLabelTemplate>): QrLabelTemplate {
  return { ...PICK_TEMPLATE, ...parts };
}

describe('templateFields', () => {
  test('lists the picked fields in slot order', () => {
    const template = withParts({
      fieldsArea: {
        ...PICK_TEMPLATE.fieldsArea,
        mode: 'pick',
        slots: [
          { ...SLOT, field: '收件人' },
          { ...SLOT, field: '电话' },
        ],
      },
      note: { ...PICK_TEMPLATE.note, visible: false },
    });
    expect(templateFields(template)).toEqual({ mode: 'PICKED', names: ['收件人', '电话'] });
  });

  // 「全部字段」模式下每个字段都会显示；这里列的是模板在别处（二维码、备注）点名要的字段。
  test('lists fields named by the QR code and the note, without the fixed variables', () => {
    const template = withParts({
      fieldsArea: { ...PICK_TEMPLATE.fieldsArea, mode: 'all' },
      qr: { ...PICK_TEMPLATE.qr, visible: true, content: { kind: 'field', field: '运单号' } },
      note: { ...PICK_TEMPLATE.note, visible: true, text: '{日期} {货架号}\n{完整内容} {运单号}' },
    });
    expect(templateFields(template)).toEqual({ mode: 'ALL', names: ['运单号', '货架号'] });
  });

  test('reads variables in QR text and ignores hidden parts', () => {
    const template = withParts({
      fieldsArea: { ...PICK_TEMPLATE.fieldsArea, mode: 'all' },
      qr: { ...PICK_TEMPLATE.qr, visible: true, content: { kind: 'text', text: 'https://x/?o={订单号}' } },
      note: { ...PICK_TEMPLATE.note, visible: false, text: '{货架号}' },
    });
    expect(templateFields(template)).toEqual({ mode: 'ALL', names: ['订单号'] });
  });

  test('lists every variable a waybill uses, top to bottom, without the fixed ones', () => {
    const { mode, names } = templateFields(PLATFORM_TWO_PART);
    expect(mode).toBe('PICKED');
    expect(names.slice(0, 5)).toEqual(['快递公司', '产品类型', '三段码', '集包编码', '集包地']);
    expect(names).toContain('运单号');
    expect(names).toContain('二维码');
    expect(names).not.toContain('日期');
    expect(new Set(names).size).toBe(names.length);
  });

  test('lists the Deppon routing fields', () => {
    expect(templateFields(DEPPON_TWO_PART).names).toEqual(expect.arrayContaining(['路由站1', '路由码4', '末端码']));
  });
});
