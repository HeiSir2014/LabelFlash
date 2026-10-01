import { GENERIC_TEMPLATE } from '../templates/builtin-templates';
import type { LabelTemplate, QrLabelTemplate } from '../templates/template-model';

/**
 * 「指定字段」的标签模板：内置模板都是「全部字段」，测「指定字段」的行为时用它。
 * 版式就是 1.3.0 之前的「样衣标准」：编码、颜色、尺码、货架号，带前缀。
 */
export const PICK_TEMPLATE: QrLabelTemplate = {
  ...GENERIC_TEMPLATE,
  id: 'custom:pick',
  name: '指定字段',
  qr: { ...GENERIC_TEMPLATE.qr, sizeMm: 24 },
  fieldsArea: {
    ...GENERIC_TEMPLATE.fieldsArea,
    mode: 'pick',
    slots: [
      { field: '编码', prefix: '编码：', fontSizeMm: 3.2, bold: true },
      { field: '颜色', prefix: '颜色：', fontSizeMm: 3.2, bold: true },
      { field: '尺码', prefix: '尺码：', fontSizeMm: 3.2, bold: true },
      { field: '货架号', prefix: '货架号：', fontSizeMm: 3.2, bold: true },
    ],
  },
  bottom: { visible: true, fontSizeMm: 3, bold: true },
};

/** 测试里断言「这是标签模板」并收窄类型：拿到面单模板时直接失败，免得后面的断言莫名其妙地挂。 */
export function labelOf(template: LabelTemplate | null | undefined): QrLabelTemplate {
  if (template?.kind !== 'label') {
    throw new Error(`expected a label template, got ${template?.kind ?? String(template)}`);
  }
  return template;
}
