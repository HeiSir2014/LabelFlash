import { describe, expect, test } from 'bun:test';
import { STANDARD_TEMPLATE } from '../templates/builtin-templates';
import type { LabelTemplate } from '../templates/template-model';
import { templateFields } from './template-fields';

const SLOT = { prefix: '', fontSizeMm: 3, bold: false };

function withParts(parts: Partial<LabelTemplate>): LabelTemplate {
  return { ...STANDARD_TEMPLATE, ...parts };
}

describe('templateFields', () => {
  test('lists the picked fields in slot order', () => {
    const template = withParts({
      fieldsArea: {
        ...STANDARD_TEMPLATE.fieldsArea,
        mode: 'pick',
        slots: [
          { ...SLOT, field: '收件人' },
          { ...SLOT, field: '电话' },
        ],
      },
      note: { ...STANDARD_TEMPLATE.note, visible: false },
    });
    expect(templateFields(template)).toEqual({ mode: 'PICKED', names: ['收件人', '电话'] });
  });

  // 「全部字段」模式下每个字段都会显示；这里列的是模板在别处（二维码、备注）点名要的字段。
  test('lists fields named by the QR code and the note, without the fixed variables', () => {
    const template = withParts({
      fieldsArea: { ...STANDARD_TEMPLATE.fieldsArea, mode: 'all' },
      qr: { ...STANDARD_TEMPLATE.qr, visible: true, content: { kind: 'field', field: '运单号' } },
      note: { ...STANDARD_TEMPLATE.note, visible: true, text: '{日期} {货架号}\n{完整内容} {运单号}' },
    });
    expect(templateFields(template)).toEqual({ mode: 'ALL', names: ['运单号', '货架号'] });
  });

  test('reads variables in QR text and ignores hidden parts', () => {
    const template = withParts({
      fieldsArea: { ...STANDARD_TEMPLATE.fieldsArea, mode: 'all' },
      qr: { ...STANDARD_TEMPLATE.qr, visible: true, content: { kind: 'text', text: 'https://x/?o={订单号}' } },
      note: { ...STANDARD_TEMPLATE.note, visible: false, text: '{货架号}' },
    });
    expect(templateFields(template)).toEqual({ mode: 'ALL', names: ['订单号'] });
  });
});
