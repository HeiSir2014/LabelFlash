import { PAPER_LIMITS_MM } from '../../shared/paper-sizes';
import { isValidFieldName } from '../scan/rule-model';
import { asLoose, bool, clamp, type Loose, pick } from './sanitize-primitives';
import { TEXT_ALIGNS } from './template-model';
import {
  RULE_STYLES,
  SPLIT_DIRECTIONS,
  VERTICAL_ALIGNS,
  WAYBILL_LIMITS,
  type WaybillContent,
  type WaybillMargins,
  type WaybillNode,
  type WaybillParagraph,
  type WaybillTemplate,
} from './waybill-model';

/** 新加的一段文字、新拆出来的格子用的默认值（编辑器也用）。 */
export const DEFAULT_PARAGRAPH: WaybillParagraph = { text: '', fontSizeMm: 3, bold: false, wrap: true };
export const EMPTY_CONTENT: WaybillContent = { kind: 'empty' };

/**
 * 面单版式部分的校验：和标签模板一样，缺失或类型错误的取 fallback，数值夹到范围。
 * 超出层数、格数、子项数的部分截掉；最后一个子项的尺寸不存（排版时按剩余算），这里置 0。
 */
export function sanitizeWaybillLayout(
  input: Loose,
  fallback: Pick<WaybillTemplate, 'marginsMm' | 'lineWidthMm' | 'root'>,
): Pick<WaybillTemplate, 'marginsMm' | 'lineWidthMm' | 'root'> {
  const budget = { nodes: WAYBILL_LIMITS.nodes };
  const rootInput = asLoose(input['root']);
  const bodyInput = asLoose(rootInput['body']);
  const children = Array.isArray(bodyInput['children']) ? sanitizeChildren(bodyInput['children'], 2, budget) : null;
  const { lineWidthMm } = WAYBILL_LIMITS;
  return {
    marginsMm: sanitizeMargins(input['marginsMm'], fallback.marginsMm),
    lineWidthMm: clamp(input['lineWidthMm'], lineWidthMm.min, lineWidthMm.max, fallback.lineWidthMm),
    root:
      children && children.length > 0
        ? { sizeMm: 0, ruleAfter: 'none', body: { split: 'rows', children } }
        : structuredClone(fallback.root),
  };
}

function sanitizeMargins(value: unknown, fallback: WaybillMargins): WaybillMargins {
  const input = asLoose(value);
  const { min, max } = WAYBILL_LIMITS.marginMm;
  return {
    top: clamp(input['top'], min, max, fallback.top),
    right: clamp(input['right'], min, max, fallback.right),
    bottom: clamp(input['bottom'], min, max, fallback.bottom),
    left: clamp(input['left'], min, max, fallback.left),
  };
}

function sanitizeChildren(values: readonly unknown[], depth: number, budget: { nodes: number }): WaybillNode[] {
  const children: WaybillNode[] = [];
  for (const value of values.slice(0, WAYBILL_LIMITS.children)) {
    if (budget.nodes <= 0) {
      break;
    }
    budget.nodes -= 1;
    children.push(sanitizeNode(asLoose(value), depth, budget));
  }
  const last = children.at(-1);
  if (last) {
    last.sizeMm = 0;
  }
  return children;
}

function sanitizeNode(input: Loose, depth: number, budget: { nodes: number }): WaybillNode {
  const body = asLoose(input['body']);
  const sizeMm = clamp(input['sizeMm'], WAYBILL_LIMITS.minSizeMm, PAPER_LIMITS_MM.height.max, WAYBILL_LIMITS.minSizeMm);
  const ruleAfter = pick(input['ruleAfter'], RULE_STYLES, 'solid');
  const split = body['split'];
  if (typeof split === 'string' && Array.isArray(body['children']) && depth < WAYBILL_LIMITS.depth) {
    const children = sanitizeChildren(body['children'], depth + 1, budget);
    if (children.length > 0) {
      return { sizeMm, ruleAfter, body: { split: pick(split, SPLIT_DIRECTIONS, 'rows'), children } };
    }
  }
  return { sizeMm, ruleAfter, body: { content: sanitizeContent(body['content']) } };
}

export function sanitizeContent(value: unknown): WaybillContent {
  const input = asLoose(value);
  const { fontSizeMm, valueLength } = WAYBILL_LIMITS;
  switch (input['kind']) {
    case 'text':
      return {
        kind: 'text',
        paragraphs: Array.isArray(input['paragraphs'])
          ? input['paragraphs'].slice(0, WAYBILL_LIMITS.paragraphs).map((paragraph) => sanitizeParagraph(paragraph))
          : [],
        align: pick(input['align'], TEXT_ALIGNS, 'left'),
        valign: pick(input['valign'], VERTICAL_ALIGNS, 'middle'),
        inverse: bool(input['inverse'], false),
        // 字段名不合法（或没填）就当作总是显示；首尾空格去掉（编辑器输入时不去，字段名中间可以有空格）。
        showIf: sanitizeShowIf(input['showIf']),
      };
    case 'barcode':
      return {
        kind: 'barcode',
        value: sanitizeText(input['value'], valueLength, '{运单号}'),
        showText: bool(input['showText'], true),
        textSizeMm: clamp(input['textSizeMm'], fontSizeMm.min, fontSizeMm.max, WAYBILL_LIMITS.barcodeTextSizeMm),
        vertical: bool(input['vertical'], false),
      };
    case 'qr':
      return { kind: 'qr', value: sanitizeText(input['value'], valueLength, '') };
    default:
      return EMPTY_CONTENT;
  }
}

function sanitizeParagraph(value: unknown): WaybillParagraph {
  const input = asLoose(value);
  const { fontSizeMm, paragraphLength } = WAYBILL_LIMITS;
  return {
    text: sanitizeText(input['text'], paragraphLength, DEFAULT_PARAGRAPH.text),
    fontSizeMm: clamp(input['fontSizeMm'], fontSizeMm.min, fontSizeMm.max, DEFAULT_PARAGRAPH.fontSizeMm),
    bold: bool(input['bold'], DEFAULT_PARAGRAPH.bold),
    wrap: bool(input['wrap'], DEFAULT_PARAGRAPH.wrap),
  };
}

function sanitizeShowIf(value: unknown): string {
  const field = typeof value === 'string' ? value.trim() : '';
  return isValidFieldName(field) ? field : '';
}

// 面单的 sanitizeText 和标签模板不同：这里的控制字符包含换行（面单格子里的文字一段一行，
// 多行靠多个段落表示，不允许在单段里换行），所以不能和标签共用同一份实现，留在本文件里。
// biome-ignore lint/suspicious/noControlCharactersInRegex: 专门用来去掉控制字符（面单上的文字不允许换行）
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

/** 面单格子里的文字一段一行（多行用多段），去掉包括换行在内的控制字符。 */
function sanitizeText(value: unknown, maxLength: number, fallback: string): string {
  return typeof value === 'string' ? value.replace(CONTROL_CHARACTERS, '').slice(0, maxLength) : fallback;
}
