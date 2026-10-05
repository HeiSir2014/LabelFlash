import { describe, expect, test } from 'bun:test';
import { columnProfile, contentBox, fullRect, inkMask, rowProfile } from './content-box';
import { blankPage, fill } from './testing/synthetic-page';

describe('content box', () => {
  test('finds nothing on a blank page', () => {
    const mask = inkMask(blankPage(50, 40));
    expect(contentBox(mask, fullRect(mask))).toBeNull();
  });

  test('finds the box around everything that is darker than paper', () => {
    const page = fill(blankPage(50, 40), { x: 5, y: 6, width: 10, height: 4 });
    fill(page, { x: 30, y: 20, width: 8, height: 10 });
    const mask = inkMask(page);
    expect(contentBox(mask, fullRect(mask))).toEqual({ x: 5, y: 6, width: 33, height: 24 });
  });

  // 抗锯齿的浅灰边、很浅的底纹不算内容，不然白边去不掉。
  test('treats light gray as paper', () => {
    const page = blankPage(20, 20);
    page.pixels.fill(230);
    fill(page, { x: 4, y: 4, width: 2, height: 2 });
    const mask = inkMask(page);
    expect(contentBox(mask, fullRect(mask))).toEqual({ x: 4, y: 4, width: 2, height: 2 });
  });

  // 扫描件上孤立的一个灰尘点不能把外框撑到页边。
  test('ignores a single speck', () => {
    const page = fill(blankPage(50, 40), { x: 10, y: 10, width: 6, height: 6 });
    page.pixels[49] = 0;
    const mask = inkMask(page);
    expect(contentBox(mask, fullRect(mask))).toEqual({ x: 10, y: 10, width: 6, height: 6 });
  });

  test('looks only inside the given rectangle', () => {
    const page = fill(blankPage(50, 40), { x: 2, y: 2, width: 4, height: 4 });
    fill(page, { x: 30, y: 30, width: 5, height: 5 });
    const mask = inkMask(page);
    expect(contentBox(mask, { x: 20, y: 20, width: 30, height: 20 })).toEqual({ x: 30, y: 30, width: 5, height: 5 });
  });

  test('counts ink per row and per column inside a rectangle', () => {
    const mask = inkMask(fill(blankPage(6, 4), { x: 1, y: 1, width: 3, height: 2 }));
    expect([...rowProfile(mask, fullRect(mask))]).toEqual([0, 3, 3, 0]);
    expect([...columnProfile(mask, { x: 0, y: 1, width: 6, height: 1 })]).toEqual([0, 1, 1, 1, 0, 0]);
  });
});
