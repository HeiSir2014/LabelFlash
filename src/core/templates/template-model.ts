import { LABEL_PAPER_MM } from '../../shared/label-paper';

/** 标签模板：结构化数据（不是任意 HTML），可校验、可持久化，打印和预览共用。纸张固定 60×40mm。 */

export const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

export const QR_LAYOUTS = ['qr-left', 'qr-right'] as const;
export type QrLayout = (typeof QR_LAYOUTS)[number];

export const QR_ERROR_LEVELS = ['L', 'M', 'Q', 'H'] as const;
export type QrErrorLevel = (typeof QR_ERROR_LEVELS)[number];

/** beside-qr = 二维码旁的空白区（字段下方）；bottom = 标签底部整行。 */
export const NOTE_PLACEMENTS = ['beside-qr', 'bottom'] as const;
export type NotePlacement = (typeof NOTE_PLACEMENTS)[number];

/** all = 按识别顺序列出全部字段；pick = 只显示模板里指定的字段。 */
export const FIELDS_MODES = ['all', 'pick'] as const;
export type FieldsMode = (typeof FIELDS_MODES)[number];

export interface TextStyle {
  fontSizeMm: number;
  bold: boolean;
}

/** 「指定字段」模式的一行：显示识别结果里名为 field 的字段。 */
export interface FieldSlot extends TextStyle {
  field: string;
  /** 字段前缀，例如「编码：」。 */
  prefix: string;
}

/** inline = 横向：前缀和值在同一行（前缀一列、值一列）；stacked = 垂直：前缀单独一行，值在下一行。 */
export const FIELD_ARRANGEMENTS = ['inline', 'stacked'] as const;
export type FieldArrangement = (typeof FIELD_ARRANGEMENTS)[number];

/** 二维码旁的字段区。两种模式的配置都保留，切换模式不丢另一种的设置。 */
export interface FieldsArea {
  mode: FieldsMode;
  arrangement: FieldArrangement;
  /** 全部字段：前缀是「字段名 + 分隔符」，showNames 关掉时只显示值。 */
  all: TextStyle & { showNames: boolean; separator: string };
  slots: FieldSlot[];
}

/** 底部整行：完整原始内容，多行用「 / 」连起来。 */
export interface BottomLine extends TextStyle {
  visible: boolean;
}

export interface NoteConfig extends TextStyle {
  visible: boolean;
  /** 支持变量：{字段名} {完整内容} {规则} {日期} {时间}；可以多行。 */
  text: string;
  placement: NotePlacement;
}

export const QR_CONTENT_KINDS = ['raw', 'field', 'text'] as const;
export type QrContentKind = (typeof QR_CONTENT_KINDS)[number];

/** 二维码内容：原始内容、某个字段，或带变量的文本；取不到内容时退回原始内容。 */
export type QrContent = { kind: 'raw' } | { kind: 'field'; field: string } | { kind: 'text'; text: string };

export interface QrConfig {
  visible: boolean;
  sizeMm: number;
  /** 首选的容错等级；内容太长放不下时逐级降低。 */
  errorCorrection: QrErrorLevel;
  content: QrContent;
}

export interface LabelTemplate {
  id: string;
  name: string;
  paddingMm: number;
  layout: QrLayout;
  /**
   * 对齐按区域统一设置，保证同一列文字对齐：
   * side = 二维码旁的字段（前缀列 + 值列的网格，对齐作用于值列）和旁边的备注；bottom = 底部整行和底部备注。
   */
  sideAlign: TextAlign;
  bottomAlign: TextAlign;
  qr: QrConfig;
  fieldsArea: FieldsArea;
  bottom: BottomLine;
  note: NoteConfig;
}

export const TEMPLATE_LIMITS = {
  paddingMm: { min: 0, max: 6 },
  qrSizeMm: { min: 10, max: LABEL_PAPER_MM.height },
  fontSizeMm: { min: 1.5, max: 8 },
  nameLength: 40,
  prefixLength: 16,
  separatorLength: 3,
  noteLength: 200,
  /** 「指定字段」最多几行。 */
  slots: 8,
  /** 「全部字段」最多显示几行（含收尾的「…等 N 项」）。 */
  allFieldRows: 6,
} as const;

/** 元素之间的固定间距（mm）。 */
export const LAYOUT_GAP_MM = 2;

export const BUILT_IN_TEMPLATE_PREFIX = 'builtin:';
export const CUSTOM_TEMPLATE_PREFIX = 'custom:';
export const TEMPLATE_ID_PATTERN = /^(builtin|custom):[\w-]{1,64}$/;

export function isBuiltInTemplateId(id: string): boolean {
  return id.startsWith(BUILT_IN_TEMPLATE_PREFIX);
}

/** 二维码允许的最大边长：纸张高度去掉上下边距。 */
export function maxQrSizeMm(paddingMm: number): number {
  return LABEL_PAPER_MM.height - 2 * paddingMm;
}

/** 二维码旁字段区的可用宽度（mm）。 */
export function sideTextWidthMm(template: LabelTemplate): number {
  const qrWidth = template.qr.visible ? template.qr.sizeMm + LAYOUT_GAP_MM : 0;
  return LABEL_PAPER_MM.width - 2 * template.paddingMm - qrWidth;
}

/** 底部整行的可用宽度（mm）。 */
export function fullTextWidthMm(template: LabelTemplate): number {
  return LABEL_PAPER_MM.width - 2 * template.paddingMm;
}
