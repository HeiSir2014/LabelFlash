import type { PaperSize } from '../../shared/paper-sizes';
import type { WaybillTemplate } from './waybill-model';

/** 标签模板：结构化数据（不是任意 HTML），可校验、可持久化，打印和预览共用。纸张尺寸由模板自己决定。 */

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

/** 两类模板共有、和版式无关的部分。 */
export interface TemplateBase {
  id: string;
  name: string;
  /** 用多大的纸：排版、预览软尺和打印页面尺寸都按它；按纸张分配打印机。 */
  paper: PaperSize;
  /** 指定的打印机（系统里的打印机名）；null = 按纸张分配。这台电脑上没有这台打印机时退回按纸张分配。 */
  printer: string | null;
}

/** 标签模板（二维码 + 字段区 + 底部整行 + 备注）：「通用 / 样衣」这些版式。 */
export interface QrLabelTemplate extends TemplateBase {
  kind: 'label';
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

/** label = 标签模板；waybill = 快递面单（格子版式，见 waybill-model.ts）。数据库里的旧模板没有 kind，按 label 读。 */
export type LabelTemplate = QrLabelTemplate | WaybillTemplate;
export type TemplateKind = LabelTemplate['kind'];

export const TEMPLATE_LIMITS = {
  paddingMm: { min: 0, max: 6 },
  /** 上限按纸张算，见 maxQrSizeMm。 */
  qrSizeMm: { min: 10 },
  fontSizeMm: { min: 1.5, max: 8 },
  nameLength: 40,
  /** 系统打印机名的长度上限：Windows 打印机名最长 256 个字符。 */
  printerNameLength: 256,
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

/** 二维码允许的最大边长：纸张的短边去掉两边的边距。60×40 时是 40 − 2 × 边距，和原来一样。 */
export function maxQrSizeMm(paper: PaperSize, paddingMm: number): number {
  return Math.min(paper.widthMm, paper.heightMm) - 2 * paddingMm;
}

/** 二维码旁字段区的可用宽度（mm）。 */
export function sideTextWidthMm(template: QrLabelTemplate): number {
  const qrWidth = template.qr.visible ? template.qr.sizeMm + LAYOUT_GAP_MM : 0;
  return template.paper.widthMm - 2 * template.paddingMm - qrWidth;
}

/** 底部整行的可用宽度（mm）。 */
export function fullTextWidthMm(template: QrLabelTemplate): number {
  return template.paper.widthMm - 2 * template.paddingMm;
}

/**
 * 换一种纸打同一个模板（测试页按打印机负责的纸打印、编辑器换纸张）：二维码跟着纸张缩小，并夹到新纸张的上限内。
 * 面单模板只换纸张：版面的最后一行（商家自定义区）在排版时吸收高度差。
 */
export function withPaper<T extends LabelTemplate>(template: T, paper: PaperSize): T {
  if (template.kind === 'waybill') {
    return { ...template, paper: { ...paper } };
  }
  return withLabelPaper(template, paper) as T;
}

function withLabelPaper(template: QrLabelTemplate, paper: PaperSize): QrLabelTemplate {
  // 纸变小时二维码按短边等比缩小：只夹到上限的话，60×40 的 22mm 二维码放到 50×30 上，底部整行会被挤出标签裁掉。
  // 纸变大时不放大，免得二维码突然占满面单。
  const shrink = Math.min(1, shortSideMm(paper) / shortSideMm(template.paper));
  const scaled = Math.round(template.qr.sizeMm * shrink * QR_SIZE_TENTHS_PER_MM) / QR_SIZE_TENTHS_PER_MM;
  const sizeMm = Math.max(TEMPLATE_LIMITS.qrSizeMm.min, Math.min(scaled, maxQrSizeMm(paper, template.paddingMm)));
  return { ...template, paper: { ...paper }, qr: { ...template.qr, sizeMm } };
}

/** 二维码边长保留到 0.1mm：和纸张尺寸的精度一致。 */
const QR_SIZE_TENTHS_PER_MM = 10;

function shortSideMm(paper: PaperSize): number {
  return Math.min(paper.widthMm, paper.heightMm);
}
