import type { CanvasTemplate } from '../templates/canvas-model';
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
    return { mode: 'PICKED', names: withoutFixed(canvasVariables(template)) };
  }
  if (template.kind === 'waybill') {
    return { mode: 'PICKED', names: withoutFixed(waybillVariables(template)) };
  }
  return labelFields(template);
}

/**
 * 判断「这个模板和当初用的是不是同一回事」：批量打印重打失败的标签时用，字段或纸张变了
 * （哪怕模板编号没变）就不能按旧样子重打，要能查出来。只看会影响印出来的东西的部分，
 * 不比较名字、备注这类不影响批量打印结果的设置。
 */
export function templateFingerprint(template: LabelTemplate): string {
  return JSON.stringify({ fields: templateFields(template), paper: template.paper });
}

/** 按记录原样重打时模板对不上：界面和主进程说同一句。 */
export const TEMPLATE_CHANGED_ISSUE = '模板改过：字段或纸张和打这一张时不一样，不能按原样重打';

/**
 * 按记录原样重打（本机接口、批量打印的记录）之前核对模板：指纹对不上就是改过，返回给用户看的原因。
 * 没有指纹的记录（2.0.0 之前写的）核对不了，照旧放行。
 */
export function storedTemplateIssue(template: LabelTemplate, fingerprint: string | undefined): string | null {
  if (fingerprint === undefined || templateFingerprint(template) === fingerprint) {
    return null;
  }
  return TEMPLATE_CHANGED_ISSUE;
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

/** 自由设计模板每个元素（文字、条码、二维码、表格每格）里用到的变量，按上下层顺序。 */
function canvasVariables(template: CanvasTemplate): string[] {
  const names: string[] = [];
  for (const element of template.elements) {
    switch (element.kind) {
      case 'text':
        names.push(...variableNames(element.text));
        break;
      case 'barcode':
      case 'qr':
        names.push(...variableNames(element.value));
        break;
      case 'table':
        for (const row of element.cells) {
          for (const cell of row) {
            names.push(...variableNames(cell.text));
          }
        }
        break;
      default:
        break;
    }
  }
  return names;
}
