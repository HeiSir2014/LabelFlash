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

/** code / color / size 排在二维码旁；raw（完整编码）排在底部。 */
export const SIDE_FIELD_KEYS = ['code', 'color', 'size'] as const;
export const FIELD_KEYS = [...SIDE_FIELD_KEYS, 'raw'] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

export interface TextStyle {
  fontSizeMm: number;
  bold: boolean;
}

export interface FieldConfig extends TextStyle {
  visible: boolean;
  /** 字段前缀，例如「编码：」。 */
  prefix: string;
}

export interface NoteConfig extends TextStyle {
  visible: boolean;
  /** 支持变量：{编码} {颜色} {尺码} {完整编码} {日期} {时间}；可以多行。 */
  text: string;
  placement: NotePlacement;
}

export interface QrConfig {
  visible: boolean;
  sizeMm: number;
  errorCorrection: QrErrorLevel;
}

export interface LabelTemplate {
  id: string;
  name: string;
  paddingMm: number;
  layout: QrLayout;
  /**
   * 对齐按区域统一设置，保证同一列文字对齐：
   * side = 二维码旁的字段（前缀列 + 值列的网格，对齐作用于值列）和旁边的备注；bottom = 底部完整编码和底部备注。
   */
  sideAlign: TextAlign;
  bottomAlign: TextAlign;
  qr: QrConfig;
  fields: Record<FieldKey, FieldConfig>;
  note: NoteConfig;
}

export const TEMPLATE_LIMITS = {
  paddingMm: { min: 0, max: 6 },
  qrSizeMm: { min: 10, max: LABEL_PAPER_MM.height },
  fontSizeMm: { min: 1.5, max: 8 },
  nameLength: 40,
  prefixLength: 16,
  noteLength: 200,
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
