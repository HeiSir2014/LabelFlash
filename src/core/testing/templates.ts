import type { LabelTemplate, QrLabelTemplate } from '../templates/template-model';

/** 测试里断言「这是标签模板」并收窄类型：拿到面单模板时直接失败，免得后面的断言莫名其妙地挂。 */
export function labelOf(template: LabelTemplate | null | undefined): QrLabelTemplate {
  if (template?.kind !== 'label') {
    throw new Error(`expected a label template, got ${template?.kind ?? String(template)}`);
  }
  return template;
}
