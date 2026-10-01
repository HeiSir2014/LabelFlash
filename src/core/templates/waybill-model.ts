import type { TemplateBase, TextAlign } from './template-model';

/**
 * 快递面单模板：版面是一棵按毫米分割的树（先分行、行里再分格，可以再分），不是一堆浮动的框。
 * 每个分割的最后一个子项占「剩下的」，所以格宽、行高永远加得满，不会有缝或重叠；
 * 线画在兄弟之间，相邻两格共用一条。设计见 docs/superpowers/specs/2026-10-01-waybill-templates-design.md。
 */

export const RULE_STYLES = ['solid', 'dashed', 'none'] as const;
export type RuleStyle = (typeof RULE_STYLES)[number];

export const SPLIT_DIRECTIONS = ['rows', 'columns'] as const;
export type SplitDirection = (typeof SPLIT_DIRECTIONS)[number];

export const VERTICAL_ALIGNS = ['top', 'middle'] as const;
export type VerticalAlign = (typeof VERTICAL_ALIGNS)[number];

export const WAYBILL_CONTENT_KINDS = ['text', 'barcode', 'qr', 'empty'] as const;
export type WaybillContentKind = (typeof WAYBILL_CONTENT_KINDS)[number];

/** 一段文字：text 里可以有 {字段名}、{日期}、{时间} 等变量。 */
export interface WaybillParagraph {
  text: string;
  fontSizeMm: number;
  bold: boolean;
  /** true = 按格宽折行；false = 只占一行，放不下先缩小字号。 */
  wrap: boolean;
}

export interface WaybillText {
  kind: 'text';
  paragraphs: WaybillParagraph[];
  align: TextAlign;
  valign: VerticalAlign;
  /** 反白：黑底白字（「收」「寄」、服务标签）。展开后没有字时不画黑底。 */
  inverse: boolean;
  /**
   * 只在这个字段有值时显示这一格（例如「集」只在有集包地时印）；空字符串 = 总是显示。
   * 平台面单上「集」「末」「虚拟号码」这类标记都是有内容才印的，没有内容时不留一个孤零零的标记。
   */
  showIf: string;
}

export interface WaybillBarcode {
  kind: 'barcode';
  /** 条码内容，通常是 {运单号}。 */
  value: string;
  /** 条码下方印号码。 */
  showText: boolean;
  textSizeMm: number;
  /** 竖排：条码转 90°（一联单右侧那一列）。 */
  vertical: boolean;
}

export interface WaybillQr {
  kind: 'qr';
  value: string;
}

export type WaybillContent = WaybillText | WaybillBarcode | WaybillQr | { kind: 'empty' };

export type WaybillBody = { split: SplitDirection; children: WaybillNode[] } | { content: WaybillContent };

export interface WaybillNode {
  /** 在父分割里占多少（mm）：父按行分时是高度，按列分时是宽度。最后一个子项按剩余重算。 */
  sizeMm: number;
  /** 和下一个兄弟之间画什么线；最后一个子项的这一项不用。 */
  ruleAfter: RuleStyle;
  body: WaybillBody;
}

export interface WaybillMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface WaybillTemplate extends TemplateBase {
  kind: 'waybill';
  marginsMm: WaybillMargins;
  lineWidthMm: number;
  /** 版面的根：按行分割，尺寸就是版面高度（sizeMm 不用）。 */
  root: WaybillNode & { body: { split: 'rows'; children: WaybillNode[] } };
}

export const WAYBILL_LIMITS = {
  /** 一张面单最多这么多个格子（叶子 + 分割）：内置模板 40 个左右，留出余量。 */
  nodes: 80,
  /** 嵌套层数（根是第 1 层）：内置模板最深 4 层。 */
  depth: 6,
  /** 一个分割最多几个子项。 */
  children: 12,
  /** 格子最小 1mm：再小放不下任何内容，也看不清线。 */
  minSizeMm: 1,
  /** 1.5mm 是热敏纸上还认得出汉字的下限；14mm 够印大头笔的三段码。 */
  fontSizeMm: { min: 1.5, max: 14 },
  /** 一格最多几段：内置模板最多 3 段（收件人、电话、地址），留一段余量。 */
  paragraphs: 4,
  /** 一段的模板文字（含变量）：最长的地址段不到 100 字。 */
  paragraphLength: 200,
  /** 条码、二维码的内容模板：运单号、网址带变量也用不了这么长。 */
  valueLength: 200,
  /** 线宽：0.2mm 以下热敏纸上时断时续，1mm 以上就是黑条了。 */
  lineWidthMm: { min: 0.2, max: 1 },
  /** 四边留白：面单纸本身有边，留 10mm 已经很宽。 */
  marginMm: { min: 0, max: 10 },
  /** 条码下方号码的默认字号。 */
  barcodeTextSizeMm: 3,
} as const;

export function isSplit(body: WaybillBody): body is { split: SplitDirection; children: WaybillNode[] } {
  return 'split' in body;
}

/** 按深度优先顺序列出所有节点（含根），编辑器的大纲和校验都用它。 */
export function walkNodes(root: WaybillNode, visit: (node: WaybillNode, depth: number, path: number[]) => void): void {
  const step = (node: WaybillNode, depth: number, path: number[]) => {
    visit(node, depth, path);
    if (isSplit(node.body)) {
      node.body.children.forEach((child, index) => {
        step(child, depth + 1, [...path, index]);
      });
    }
  };
  step(root, 1, []);
}
