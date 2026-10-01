import { NOTE_VARIABLES, variableNames } from '../templates/note-text';
import type { LabelTemplate, QrLabelTemplate } from '../templates/template-model';
import { isSplit, type WaybillTemplate, walkNodes } from '../templates/waybill-model';

/** 模板怎么用字段：ALL = 按给的顺序显示全部字段；PICKED = 只显示指定的字段。 */
export interface TemplateFields {
  mode: 'ALL' | 'PICKED';
  /** 模板点名要的字段（指定字段的每一行、二维码取的字段、备注和二维码文本里的 {字段名}），按出现顺序、不重复。 */
  names: string[];
}

const FIXED_VARIABLE_NAMES: ReadonlySet<string> = new Set(NOTE_VARIABLES.map((variable) => variable.slice(1, -1)));

/** 给第三方看的「这个模板要哪些字段」；隐藏的二维码、备注里的变量不算。 */
export function templateFields(template: LabelTemplate): TemplateFields {
  if (template.kind === 'canvas') {
    // Task 9 换成真正列出自由设计模板用到的变量。
    return { mode: 'PICKED', names: [] };
  }
  if (template.kind === 'waybill') {
    return { mode: 'PICKED', names: withoutFixed(waybillVariables(template)) };
  }
  return labelFields(template);
}

function labelFields(template: QrLabelTemplate): TemplateFields {
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
  return { mode: template.fieldsArea.mode === 'pick' ? 'PICKED' : 'ALL', names: withoutFixed(names) };
}

/** 面单每一格（文字的每一段、条码、二维码）里用到的变量，按版面从上到下、从左到右。 */
function waybillVariables(template: WaybillTemplate): string[] {
  const names: string[] = [];
  walkNodes(template.root, (node) => {
    if (isSplit(node.body)) {
      return;
    }
    const { content } = node.body;
    if (content.kind === 'text') {
      names.push(...content.paragraphs.flatMap((paragraph) => variableNames(paragraph.text)));
      if (content.showIf !== '') {
        names.push(content.showIf);
      }
    } else if (content.kind === 'barcode' || content.kind === 'qr') {
      names.push(...variableNames(content.value));
    }
  });
  return names;
}

function withoutFixed(names: readonly string[]): string[] {
  return [...new Set(names.filter((name) => !FIXED_VARIABLE_NAMES.has(name)))];
}
