import { describe, expect, test } from 'bun:test';
import {
  BELOW_CODE_AREA,
  type CodeSquare,
  findImageText,
  type ImageTextRegion,
  normalizeImageText,
  SHELF_NUMBER_PATTERN,
  searchOrder,
} from './image-text';
import type { RegexRunner } from './recognize';

/** 测试里直接执行正则（主进程用隔离环境，行为一致）。 */
const runRegex: RegexRunner = (pattern, flags, input) => new RegExp(pattern, flags).exec(input)?.groups ?? null;

/** 二维码在截图的 (100, 50)，边长 200。 */
const CODE: CodeSquare = { x: 100, y: 50, size: 200 };

/** 中心在 (cx, cy)、宽 w、高 h 的一段字。 */
function line(text: string, cx: number, cy: number, w = 120, h = 30): ImageTextRegion {
  const [l, r, t, b] = [cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2];
  return {
    box: [
      { x: l, y: t },
      { x: r, y: t },
      { x: r, y: b },
      { x: l, y: b },
    ],
    text,
    score: 0.99,
  };
}

const anywhere = { pattern: SHELF_NUMBER_PATTERN, flags: '', preferredArea: null };

/** 只看找到的值。 */
const findValue = (...args: Parameters<typeof findImageText>) => findImageText(...args)?.value ?? null;
const belowFirst = { pattern: SHELF_NUMBER_PATTERN, flags: '', preferredArea: BELOW_CODE_AREA };

describe('normalizeImageText', () => {
  test('turns the dashes OCR reads into hyphens', () => {
    expect(normalizeImageText('A一1—2－3')).toBe('A-1-2-3');
    expect(normalizeImageText('A - 12 -3 - 10')).toBe('A-12-3-10');
  });

  test('turns full-width letters and digits into ASCII', () => {
    expect(normalizeImageText('Ａ－１２－３－４')).toBe('A-12-3-4');
  });

  test('does not guess between look-alike letters and digits', () => {
    expect(normalizeImageText('4-1-2-3')).toBe('4-1-2-3');
  });
});

describe('searchOrder', () => {
  test('drops text read from the code itself', () => {
    const regions = [line('曙', 200, 150), line('A-1-2-3', 200, 310)];
    expect(searchOrder(regions, CODE, null).map((r) => r.text)).toEqual(['A-1-2-3']);
  });

  test('looks in the preferred area first, then everywhere else in reading order', () => {
    // 二维码下方 1.0–1.6 个边长：y 250–370。
    const regions = [
      line('编码：CL5640-TK', 420, 80),
      line('A-1-2-3', 200, 290),
      line('CL5640-TK-图片色-36', 250, 420),
    ];
    expect(searchOrder(regions, CODE, BELOW_CODE_AREA).map((r) => r.text)).toEqual([
      'A-1-2-3',
      '编码：CL5640-TK',
      'CL5640-TK-图片色-36',
    ]);
  });
});

describe('findImageText', () => {
  test('reads a shelf number with two-digit parts', () => {
    const regions = [line('尺码：36', 420, 150), line('B-12-3-10', 200, 290)];
    expect(findValue(regions, CODE, anywhere, runRegex)).toBe('B-12-3-10');
  });

  test('takes the matching part of a longer line', () => {
    expect(findValue([line('货架 A-1-2-3 号', 200, 290)], CODE, anywhere, runRegex)).toBe('A-1-2-3');
  });

  test('matches after normalizing dashes', () => {
    expect(findValue([line('A一1一2一3', 200, 290)], CODE, belowFirst, runRegex)).toBe('A-1-2-3');
  });

  // 货架号换了位置（印到了二维码右边）：优先区域里没有，照样在标签别处找到。
  test('still finds the value after it moved out of the preferred area', () => {
    const regions = [line('4-1-2-3', 200, 290), line('A-1-2-3', 420, 120)];
    expect(findValue(regions, CODE, belowFirst, runRegex)).toBe('A-1-2-3');
  });

  test('prefers the area when two places look like a shelf number', () => {
    const regions = [line('B-9-9-9', 420, 120), line('A-1-2-3', 200, 290)];
    expect(findValue(regions, CODE, belowFirst, runRegex)).toBe('A-1-2-3');
  });

  test('uses the first match in reading order without a preferred area', () => {
    const regions = [line('A-1-2-3', 200, 280), line('A-9-9-9', 200, 340)];
    expect(findValue(regions, CODE, anywhere, runRegex)).toBe('A-1-2-3');
  });

  test('returns null when nothing matches', () => {
    const regions = [line('4-1-2-3', 200, 290), line('尺码：36', 420, 120)];
    expect(findValue(regions, CODE, anywhere, runRegex)).toBeNull();
  });

  test('does not cut a shelf number out of a longer code', () => {
    expect(findValue([line('XA-1-2-3456', 200, 290)], CODE, anywhere, runRegex)).toBeNull();
  });

  test('returns how sure the OCR was about the line it took the value from', () => {
    const doubtful = { ...line('E-113-409-55', 200, 290), score: 0.82 };
    expect(findImageText([doubtful], CODE, anywhere, runRegex)).toEqual({ value: 'E-113-409-55', score: 0.82 });
  });

  test('treats a timed-out regex as no match', () => {
    const timedOut: RegexRunner = () => null;
    expect(findValue([line('A-1-2-3', 200, 290)], CODE, anywhere, timedOut)).toBeNull();
  });
});
