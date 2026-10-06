import { MIN_BOX_FRACTION } from '../../../core/pdf/parse-pdf-request';
import { type CropMode, type NormalizedBox, PDF_LIMITS } from '../../../core/pdf/pdf-model';
import { formatPaperName, PAPER_PRESETS, paperKey, parsePaperKey } from '../../../shared/paper-sizes';
import { PDF_PRINTING_ISSUE, type PdfStatus } from '../../../shared/pdf';

/** 没有特别分配时默认用 100×150 面单纸：PDF 打印最常见的就是平台导出的电子面单。 */
export const DEFAULT_PDF_PAPER_KEY = '100x150';

/** 认 PDF 只看扩展名（拖进窗口时分流用）；是不是真的 PDF 由主进程看文件头。 */
export function isPdfFileName(name: string): boolean {
  return /\.pdf$/i.test(name.trim());
}

export interface CropChoice {
  mode: CropMode;
  label: string;
  hint: string;
}

export const CROP_CHOICES: readonly CropChoice[] = [
  { mode: 'page', label: '整页', hint: '整页缩放到纸上，横竖和纸不一样时自动转过来' },
  { mode: 'trim', label: '去白边', hint: '裁掉四周的空白再缩放（A4 上打的一张面单）' },
  { mode: 'split', label: '一页多张', hint: '按空白或分割线切开，每块打一张（A4 上的四联面单）' },
  { mode: 'manual', label: '手动框选', hint: '在第一页上画框，每一页按同样的位置裁（固定格式的导出件）' },
];

/** 单选项的文字：自动识别出的那一种后面注明。 */
export function cropLabel(mode: CropMode, detected: CropMode | null): string {
  const label = CROP_CHOICES.find((choice) => choice.mode === mode)?.label ?? mode;
  return mode === detected ? `${label}（自动识别）` : label;
}

export interface PaperOption {
  key: string;
  label: string;
  hasPrinter: boolean;
}

/** 纸张下拉：分配了打印机的纸在前（写上打印机），其余预设在后（注明没有打印机，打的时候会暂停提示）。 */
export function paperOptions(paperPrinters: Readonly<Record<string, string>>): PaperOption[] {
  const assigned = Object.entries(paperPrinters).flatMap(([key, printer]) => {
    const paper = parsePaperKey(key);
    return paper === null ? [] : [{ key, label: `${formatPaperName(paper)} · ${printer}`, hasPrinter: true }];
  });
  const others = PAPER_PRESETS.filter((preset) => !Object.hasOwn(paperPrinters, paperKey(preset))).map((preset) => ({
    key: paperKey(preset),
    label: `${preset.name}（没有分配打印机）`,
    hasPrinter: false,
  }));
  return [...assigned, ...others];
}

export function defaultPaperKey(paperPrinters: Readonly<Record<string, string>>): string {
  if (Object.hasOwn(paperPrinters, DEFAULT_PDF_PAPER_KEY)) {
    return DEFAULT_PDF_PAPER_KEY;
  }
  return Object.keys(paperPrinters).find((key) => parsePaperKey(key) !== null) ?? DEFAULT_PDF_PAPER_KEY;
}

/** 第一页上的一点，按页面宽高的比例（0–1）。 */
export interface Point {
  x: number;
  y: number;
}

/** 拖动的起点、终点 → 框（任意方向拖都行，超出页面的部分收回来）；点一下、拖得太小返回 null。 */
export function boxFromDrag(start: Point, end: Point): NormalizedBox | null {
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const left = clamp(Math.min(start.x, end.x));
  const right = clamp(Math.max(start.x, end.x));
  const top = clamp(Math.min(start.y, end.y));
  const bottom = clamp(Math.max(start.y, end.y));
  const box = { x: left, y: top, width: right - left, height: bottom - top };
  return box.width >= MIN_BOX_FRACTION && box.height >= MIN_BOX_FRACTION ? box : null;
}

export function canAddBox(boxes: readonly NormalizedBox[]): boolean {
  return boxes.length < PDF_LIMITS.manualBoxes;
}

/** 要打的块（按打印顺序，删掉的不在里面）。 */
export function visibleOrder(order: readonly string[], removed: ReadonlySet<string>): string[] {
  return order.filter((id) => !removed.has(id));
}

/** 和看得见的前一张（后一张）换位置；删掉的留在原位，恢复时回到原来的地方。到头了不动。 */
export function movePiece(order: readonly string[], id: string, delta: -1 | 1, removed: ReadonlySet<string>): string[] {
  const next = [...order];
  const from = next.indexOf(id);
  if (from === -1) {
    return next;
  }
  let to = from + delta;
  while (to >= 0 && to < next.length && removed.has(next[to] ?? '')) {
    to += delta;
  }
  const other = next[to];
  if (other === undefined) {
    return next;
  }
  next[to] = id;
  next[from] = other;
  return next;
}

export function printCount(order: readonly string[], removed: ReadonlySet<string>, copies: number): number {
  return visibleOrder(order, removed).length * copies;
}

export function describePieces({ total, removed, copies }: { total: number; removed: number; copies: number }): string {
  const parts = [`共 ${total} 张`];
  if (removed > 0) {
    parts.push(`删掉 ${removed} 张`);
  }
  parts.push(`每张 ${copies} 份`, `打 ${(total - removed) * copies} 张`);
  return parts.join(' · ');
}

/** 份数输入框：1–99，不是数字时按 1。 */
export function parseCopies(text: string): number {
  const copies = Number.parseInt(text, 10);
  return Number.isFinite(copies) ? Math.min(PDF_LIMITS.copies, Math.max(1, copies)) : 1;
}

export function describeProcessing({ done, total }: { done: number; total: number }): string {
  return `正在处理第 ${Math.min(done + 1, total)} / ${total} 页…`;
}

/**
 * 正在打印、不能换文件改设置：按主进程的 isActive（取消后最后一张还在送也算），不自己按
 * print.state 猜——主进程判定的窗口比 running/paused 更宽，两边不一致的那段时间会出 bug
 * （例如主进程已经拒绝了一次出块，界面却以为没在打，把结果当成真的作废清空）。
 */
export function isPdfPrinting(status: PdfStatus | null): boolean {
  return status?.isActive ?? false;
}

/**
 * 主进程因为「正在打印」拒绝出块、关文件时，界面要保留已经出好的块，不能清空重来：
 * 那只是暂时拒绝，不是这次出块真的作废了。其余原因（文件坏了、处理出错……）照常清空。
 */
export function keepsResultOnIssue(issue: string): boolean {
  return issue === PDF_PRINTING_ISSUE;
}
