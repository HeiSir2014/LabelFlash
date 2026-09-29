import { NOTE_VARIABLES, variableNames } from '../templates/note-text';
import type { LabelTemplate } from '../templates/template-model';

/** 模板怎么用字段：ALL = 按给的顺序显示全部字段；PICKED = 只显示指定的字段。 */
export interface TemplateFields {
  mode: 'ALL' | 'PICKED';
  /** 模板点名要的字段（指定字段的每一行、二维码取的字段、备注和二维码文本里的 {字段名}），按出现顺序、不重复。 */
  names: string[];
}

const FIXED_VARIABLE_NAMES: ReadonlySet<string> = new Set(NOTE_VARIABLES.map((variable) => variable.slice(1, -1)));

/** 给第三方看的「这个模板要哪些字段」；隐藏的二维码、备注里的变量不算。 */
export function templateFields(template: LabelTemplate): TemplateFields {
  const names: string[] = [];
  if (template.fieldsArea.mode === 'pick') {
    names.push(...template.fieldsArea.slots.map((slot) => slot.field));
  }
  const { qr, note } = template;
  if (qr.visible && qr.content.kind === 'field') {
    names.push(qr.content.field);
  }
  if (qr.visible && qr.content.kind === 'text') {
    names.push(...variableNames(qr.content.text));
  }
  if (note.visible) {
    names.push(...variableNames(note.text));
  }
  return {
    mode: template.fieldsArea.mode === 'pick' ? 'PICKED' : 'ALL',
    names: [...new Set(names.filter((name) => !FIXED_VARIABLE_NAMES.has(name)))],
  };
}
