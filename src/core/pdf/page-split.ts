import { columnProfile, contentBox, fullRect, type InkMask, rowProfile } from './content-box';
import type { CropMode, NormalizedBox, PixelRect } from './pdf-model';

const MM_PER_INCH = 25.4;
/** 两张之间至少 4mm 空白才算缝：面单里字行之间的空白不到 2mm，带框的面单里每一行都有边框的墨。 */
const MIN_GAP_MM = 4;
/** 分割线（实线或虚线）最粗 1mm：再粗就是内容里的色块。 */
const MAX_DIVIDER_MM = 1;
/** 一块至少 20mm 见方：更小的是页码、页脚这类零碎，不当一张标签。 */
const MIN_PIECE_MM = 20;
/** 四周空白都有 10mm 以上才建议「去白边」：铺满一页的 PDF 边距一般只有几毫米。 */
const TRIM_MARGIN_MM = 10;

/** 分割线上的墨点至少占这一段的一半：裁切用的虚线一般一半左右是墨，实线是满的。 */
export const DIVIDER_COVERAGE = 0.5;
/** 一页最多切成 4 行或 4 列：A4 上 2×2、1×3、4 行的小标签都在内。 */
const MAX_GRID_PARTS = 4;
/** 分割线离等分位置最多偏这一段的 5%：靠「正好等分」区分切线和面单里的表格线。 */
const GRID_TOLERANCE = 0.05;
/** 几块的宽、高都在中位数的 ±20% 以内才算「一页多张」：同一种面单排成一页，大小基本一样。 */
const SIMILAR_SIZE = 0.2;
/** 内容外框不到页面的 80% 时也建议去白边（例如 A4 左上角的一张面单）。 */
const TRIM_AREA_RATIO = 0.8;
/** XY 切分的层次：行 → 列 → 行，一行两张、另一行三张也切得开。 */
const CUT_AXES = ['rows', 'columns', 'rows'] as const;

/** 切分用的长度（像素），按渲染出来的分辨率由毫米换算。 */
export interface SplitOptions {
  minGapPx: number;
  maxDividerPx: number;
  minPiecePx: number;
  trimMarginPx: number;
}

export function splitOptionsFor(dpi: number): SplitOptions {
  const pixels = (mm: number) => Math.max(1, Math.round((mm * dpi) / MM_PER_INCH));
  return {
    minGapPx: pixels(MIN_GAP_MM),
    maxDividerPx: pixels(MAX_DIVIDER_MM),
    minPiecePx: pixels(MIN_PIECE_MM),
    trimMarginPx: pixels(TRIM_MARGIN_MM),
  };
}

/** 一段下标 [start, end)。 */
export interface Run {
  start: number;
  end: number;
}

/** profile 里连续满足 test、至少 minLength 长的段。 */
export function runsWhere(profile: ArrayLike<number>, test: (count: number) => boolean, minLength: number): Run[] {
  const runs: Run[] = [];
  let start = -1;
  for (let index = 0; index <= profile.length; index += 1) {
    const isIn = index < profile.length && test(profile[index] ?? 0);
    if (isIn && start === -1) {
      start = index;
    }
    if (!isIn && start !== -1) {
      if (index - start >= minLength) {
        runs.push({ start, end: index });
      }
      start = -1;
    }
  }
  return runs;
}

/**
 * 等分位置上的分割线：墨点占这一段（span 是和它垂直的长度）的 DIVIDER_COVERAGE 以上、不超过 maxDividerPx 粗，
 * 并且 k-1 条正好把这一段等分成 k 份（k 从 4 往下试，每个等分位置取离它最近的一条）。
 */
export function regularDividers(profile: ArrayLike<number>, span: number, options: SplitOptions): Run[] {
  const candidates = runsWhere(profile, (count) => count >= span * DIVIDER_COVERAGE, 1).filter(
    (run) => run.end - run.start <= options.maxDividerPx,
  );
  const length = profile.length;
  const center = (run: Run) => (run.start + run.end) / 2;
  for (let parts = MAX_GRID_PARTS; parts >= 2; parts -= 1) {
    const picked: Run[] = [];
    for (let cut = 1; cut < parts; cut += 1) {
      const target = (length * cut) / parts;
      const nearest = candidates
        .filter((run) => Math.abs(center(run) - target) <= length * GRID_TOLERANCE)
        .sort((a, b) => Math.abs(center(a) - target) - Math.abs(center(b) - target))[0];
      if (nearest === undefined) {
        break;
      }
      picked.push(nearest);
    }
    if (picked.length === parts - 1) {
      return picked;
    }
  }
  return [];
}

/** 把长 length 的一段按分隔（缝、分割线）切开，返回每一份。 */
function segments(length: number, separators: readonly Run[]): Run[] {
  const sorted = [...separators].sort((a, b) => a.start - b.start);
  const parts: Run[] = [];
  let start = 0;
  for (const separator of sorted) {
    if (separator.start > start) {
      parts.push({ start, end: separator.start });
    }
    start = Math.max(start, separator.end);
  }
  if (start < length) {
    parts.push({ start, end: length });
  }
  return parts;
}

interface Dividers {
  /** 整页内容外框坐标下的横线、竖线。 */
  rows: Run[];
  columns: Run[];
}

/** 把分割线从墨迹里擦掉：竖的分割线不再让每一行都「有墨」，缝才找得到。 */
function withoutDividers(mask: InkMask, page: PixelRect, dividers: Dividers): InkMask {
  const ink = mask.ink.slice();
  for (const run of dividers.rows) {
    for (let y = page.y + run.start; y < page.y + run.end; y += 1) {
      ink.fill(0, y * mask.width + page.x, y * mask.width + page.x + page.width);
    }
  }
  for (const run of dividers.columns) {
    for (let y = page.y; y < page.y + page.height; y += 1) {
      ink.fill(0, y * mask.width + page.x + run.start, y * mask.width + page.x + run.end);
    }
  }
  return { ...mask, ink };
}

/** XY 切分的一层：先收到内容外框，再按这一层方向上的缝切开，每一份交给下一层。 */
function cut(mask: InkMask, rect: PixelRect, level: number, options: SplitOptions, out: PixelRect[]): void {
  const box = contentBox(mask, rect);
  if (box === null) {
    return;
  }
  const axis = CUT_AXES[level];
  if (axis === undefined) {
    out.push(box);
    return;
  }
  const isRows = axis === 'rows';
  const profile = isRows ? rowProfile(mask, box) : columnProfile(mask, box);
  const gaps = runsWhere(profile, (count) => count === 0, options.minGapPx);
  for (const part of segments(profile.length, gaps)) {
    const next: PixelRect = isRows
      ? { x: box.x, y: box.y + part.start, width: box.width, height: part.end - part.start }
      : { x: box.x + part.start, y: box.y, width: part.end - part.start, height: box.height };
    cut(mask, next, level + 1, options, out);
  }
}

/** 丢掉比 minPiecePx 小的零碎（页码、页脚、切下来的虚线细条）。 */
function bigEnough(pieces: readonly PixelRect[], options: SplitOptions): PixelRect[] {
  return pieces.filter((piece) => piece.width >= options.minPiecePx && piece.height >= options.minPiecePx);
}

/**
 * 按分割线切出的格子，每格收到内容外框。格子里面不再按缝切：紧挨着排的面单没有外框，
 * 字行和条码之间常有一大片空白，再按缝切就把一张面单切碎了；分割线已经说清了一张有多大。
 */
function cutAtDividers(mask: InkMask, page: PixelRect, dividers: Dividers): PixelRect[] {
  const pieces: PixelRect[] = [];
  for (const row of segments(page.height, dividers.rows)) {
    for (const column of segments(page.width, dividers.columns)) {
      const cell = {
        x: page.x + column.start,
        y: page.y + row.start,
        width: column.end - column.start,
        height: row.end - row.start,
      };
      const box = contentBox(mask, cell);
      if (box !== null) {
        pieces.push(box);
      }
    }
  }
  return pieces;
}

/**
 * 一页切成几张（按阅读顺序：先上后下、先左后右）。先只按缝切；切不出两张时（几张紧挨着）再找等分位置上的分割线，
 * 擦掉它们、以它们为界切成格子。缝优先：带框的面单之间有缝时，靠近中线的是面单自己的边框，不能当切线擦掉。
 */
export function splitPage(mask: InkMask, options: SplitOptions): PixelRect[] {
  const page = contentBox(mask, fullRect(mask));
  if (page === null) {
    return [];
  }
  const byGapsAll: PixelRect[] = [];
  cut(mask, page, 0, options, byGapsAll);
  const byGaps = bigEnough(byGapsAll, options);
  if (byGaps.length > 1) {
    return byGaps;
  }
  const dividers: Dividers = {
    rows: regularDividers(rowProfile(mask, page), page.width, options),
    columns: regularDividers(columnProfile(mask, page), page.height, options),
  };
  if (dividers.rows.length === 0 && dividers.columns.length === 0) {
    return byGaps;
  }
  return bigEnough(cutAtDividers(withoutDividers(mask, page, dividers), page, dividers), options);
}

function isNearMedian(values: readonly number[]): boolean {
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return values.every((value) => Math.abs(value - median) <= median * SIMILAR_SIZE);
}

/**
 * 第一页该用哪种裁切方式：切得出两张以上、大小差不多 → 一页多张；四周都有大片空白或内容不到页面的 80% → 去白边；
 * 其余（包括空白页）→ 整页。操作员可以改。
 */
export function detectCropMode(mask: InkMask, options: SplitOptions): CropMode {
  const box = contentBox(mask, fullRect(mask));
  if (box === null) {
    return 'page';
  }
  const pieces = splitPage(mask, options);
  if (
    pieces.length >= 2 &&
    isNearMedian(pieces.map((piece) => piece.width)) &&
    isNearMedian(pieces.map((piece) => piece.height))
  ) {
    return 'split';
  }
  const margin = Math.min(box.x, box.y, mask.width - box.x - box.width, mask.height - box.y - box.height);
  const area = (box.width * box.height) / (mask.width * mask.height);
  return margin >= options.trimMarginPx || area < TRIM_AREA_RATIO ? 'trim' : 'page';
}

/** 按比例记的框 → 这一页上的像素矩形（收在页面内，至少 1 像素）。 */
export function boxRect(box: NormalizedBox, size: { width: number; height: number }): PixelRect {
  const x = Math.min(size.width - 1, Math.max(0, Math.round(box.x * size.width)));
  const y = Math.min(size.height - 1, Math.max(0, Math.round(box.y * size.height)));
  const right = Math.min(size.width, Math.round((box.x + box.width) * size.width));
  const bottom = Math.min(size.height, Math.round((box.y + box.height) * size.height));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

/**
 * 这一页按裁切方式要打的矩形（按打印顺序）。空白页（以及手动框里是空白的框）不出块：打一张白纸没有意义。
 * 一页多张切不出来时退回内容外框（例如这一页只剩一张小标签）。
 */
export function cropRects(
  mode: CropMode,
  mask: InkMask,
  options: SplitOptions,
  boxes: readonly NormalizedBox[],
): PixelRect[] {
  const whole = fullRect(mask);
  const content = contentBox(mask, whole);
  switch (mode) {
    case 'page':
      return content === null ? [] : [whole];
    case 'trim':
      return content === null ? [] : [content];
    case 'split': {
      const pieces = splitPage(mask, options);
      if (pieces.length > 0) {
        return pieces;
      }
      return content === null ? [] : [content];
    }
    case 'manual':
      return boxes.map((box) => boxRect(box, mask)).filter((rect) => contentBox(mask, rect) !== null);
  }
}
