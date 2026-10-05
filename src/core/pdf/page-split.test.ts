import { describe, expect, test } from 'bun:test';
import { inkMask } from './content-box';
import {
  boxRect,
  cropRects,
  detectCropMode,
  regularDividers,
  runsWhere,
  type SplitOptions,
  splitOptionsFor,
  splitPage,
} from './page-split';
import {
  blankPage,
  dashedColumn,
  dashedRow,
  denseLabel,
  fill,
  framedLabel,
  GRID_LABELS,
  gridPage,
} from './testing/synthetic-page';

/** 合成页面约 0.5mm 一个像素：缝至少 8 像素（4mm）、分割线最粗 3、一块至少 40、去白边的边距 20。 */
const OPTIONS: SplitOptions = { minGapPx: 8, maxDividerPx: 3, minPiecePx: 40, trimMarginPx: 20 };

/** 2×2 四张紧挨着的面单，中间只有虚线（缝只有一两个像素）。 */
function dividedPage() {
  const page = blankPage(400, 560);
  for (const [x, y] of [
    [12, 12],
    [203, 12],
    [12, 283],
    [203, 283],
  ] as const) {
    denseLabel(page, x, y);
  }
  dashedColumn(page, 199, 2, 6, 4);
  dashedRow(page, 280, 2, 6, 4);
  return page;
}

describe('split options', () => {
  test('turns millimetres into pixels at the rendered resolution', () => {
    expect(splitOptionsFor(203)).toEqual({ minGapPx: 32, maxDividerPx: 8, minPiecePx: 160, trimMarginPx: 80 });
  });
});

describe('runsWhere', () => {
  test('lists runs that pass the test and are long enough', () => {
    expect(runsWhere([0, 0, 5, 0, 0, 0, 7], (count) => count === 0, 2)).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 6 },
    ]);
  });
});

describe('regularDividers', () => {
  test('finds a thin line that halves the span', () => {
    const profile = new Array<number>(100).fill(10);
    profile[49] = 90;
    profile[50] = 90;
    expect(regularDividers(profile, 100, OPTIONS)).toEqual([{ start: 49, end: 51 }]);
  });

  test('finds the lines of a three-way split', () => {
    const profile = new Array<number>(90).fill(10);
    profile[30] = 80;
    profile[60] = 80;
    expect(regularDividers(profile, 100, OPTIONS)).toEqual([
      { start: 30, end: 31 },
      { start: 60, end: 61 },
    ]);
  });

  // 面单里的表格线（例如二联面单 60% 处的那条）不在等分位置上：不是切线。
  test('ignores a full line that does not divide the span evenly', () => {
    const profile = new Array<number>(100).fill(10);
    profile[60] = 100;
    expect(regularDividers(profile, 100, OPTIONS)).toEqual([]);
  });

  test('ignores a thick band in the middle', () => {
    const profile = new Array<number>(100).fill(10);
    profile.fill(100, 45, 55);
    expect(regularDividers(profile, 100, OPTIONS)).toEqual([]);
  });
});

describe('splitPage', () => {
  test('cuts four labels on a page at the blank gaps, in reading order', () => {
    expect(splitPage(inkMask(gridPage()), OPTIONS)).toEqual([...GRID_LABELS]);
  });

  test('cuts labels that touch along dashed divider lines', () => {
    expect(splitPage(inkMask(dividedPage()), OPTIONS)).toEqual([
      { x: 12, y: 12, width: 185, height: 266 },
      { x: 203, y: 12, width: 185, height: 266 },
      { x: 12, y: 283, width: 185, height: 266 },
      { x: 203, y: 283, width: 185, height: 266 },
    ]);
  });

  test('keeps one label with a full-width line inside it whole', () => {
    const page = framedLabel(blankPage(400, 560), { x: 20, y: 20, width: 360, height: 520 });
    fill(page, { x: 20, y: 332, width: 360, height: 2 });
    expect(splitPage(inkMask(page), OPTIONS)).toEqual([{ x: 20, y: 20, width: 360, height: 520 }]);
  });

  // 页脚的页码这类零碎不当一张标签。
  test('drops scraps smaller than a label', () => {
    const page = fill(gridPage(), { x: 190, y: 548, width: 20, height: 8 });
    expect(splitPage(inkMask(page), OPTIONS)).toEqual([...GRID_LABELS]);
  });

  test('finds nothing on a blank page', () => {
    expect(splitPage(inkMask(blankPage(100, 100)), OPTIONS)).toEqual([]);
  });
});

describe('detectCropMode', () => {
  test('suggests splitting a page of same-sized labels', () => {
    expect(detectCropMode(inkMask(gridPage()), OPTIONS)).toBe('split');
    expect(detectCropMode(inkMask(dividedPage()), OPTIONS)).toBe('split');
  });

  test('suggests trimming one label with wide margins around it', () => {
    const page = framedLabel(blankPage(400, 560), { x: 20, y: 20, width: 100, height: 150 });
    expect(detectCropMode(inkMask(page), OPTIONS)).toBe('trim');
  });

  test('keeps the whole page when content reaches its edges', () => {
    const page = framedLabel(blankPage(400, 560), { x: 5, y: 5, width: 390, height: 550 });
    expect(detectCropMode(inkMask(page), OPTIONS)).toBe('page');
    expect(detectCropMode(inkMask(blankPage(400, 560)), OPTIONS)).toBe('page');
  });
});

describe('cropRects', () => {
  const grid = inkMask(gridPage());

  test('gives the whole page, the content box or the pieces', () => {
    expect(cropRects('page', grid, OPTIONS, [])).toEqual([{ x: 0, y: 0, width: 400, height: 560 }]);
    expect(cropRects('trim', grid, OPTIONS, [])).toEqual([{ x: 20, y: 20, width: 360, height: 520 }]);
    expect(cropRects('split', grid, OPTIONS, [])).toEqual([...GRID_LABELS]);
  });

  test('falls back to the content box when nothing can be split', () => {
    const page = inkMask(fill(blankPage(400, 560), { x: 10, y: 10, width: 30, height: 30 }));
    expect(cropRects('split', page, OPTIONS, [])).toEqual([{ x: 10, y: 10, width: 30, height: 30 }]);
  });

  test('skips blank pages in every mode', () => {
    const blank = inkMask(blankPage(400, 560));
    for (const mode of ['page', 'trim', 'split'] as const) {
      expect(cropRects(mode, blank, OPTIONS, [])).toEqual([]);
    }
  });

  test('applies manual boxes by proportion and skips the blank ones', () => {
    const boxes = [
      { x: 0, y: 0, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0.97, width: 0.5, height: 0.03 },
    ];
    expect(cropRects('manual', grid, OPTIONS, boxes)).toEqual([{ x: 0, y: 0, width: 200, height: 280 }]);
  });

  test('keeps a box inside the page', () => {
    expect(boxRect({ x: 0.9, y: 0.9, width: 0.2, height: 0.2 }, { width: 100, height: 50 })).toEqual({
      x: 90,
      y: 45,
      width: 10,
      height: 5,
    });
  });
});
