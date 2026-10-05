import { describe, expect, test } from 'bun:test';
import { PDF_LIMITS } from '../core/pdf/pdf-model';
import { readRenderReply, renderedSize, renderScale, rgbaToGray } from './pdf-render-protocol';

const A4 = { width: 595, height: 842 };

describe('renderScale', () => {
  test('renders at the printer resolution', () => {
    expect(renderScale(A4, 203, PDF_LIMITS.pagePixels)).toBeCloseTo(203 / 72);
  });

  test('lowers the resolution of very large pages to stay under the pixel limit', () => {
    const a0 = { width: 2384, height: 3370 };
    const size = renderedSize(a0, renderScale(a0, 300, PDF_LIMITS.pagePixels));
    expect(size.width * size.height).toBeLessThanOrEqual(PDF_LIMITS.pagePixels);
    expect(size.width * size.height).toBeGreaterThan(PDF_LIMITS.pagePixels * 0.99);
  });

  test('keeps both sides within the canvas limit', () => {
    const strip = { width: 14_400, height: 10 };
    expect(renderedSize(strip, renderScale(strip, 600, Number.MAX_SAFE_INTEGER)).width).toBeLessThanOrEqual(32_767);
  });
});

describe('rgbaToGray', () => {
  test('weighs the channels like the eye and treats transparency as paper', () => {
    const gray = new Uint8Array(4);
    rgbaToGray(Uint8ClampedArray.of(0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 0, 0, 0), gray);
    expect([...gray]).toEqual([0, 255, 76, 255]);
  });
});

describe('readRenderReply', () => {
  const opened = { id: 1, kind: 'opened', maxPages: 200 } as const;
  const rendered = { id: 2, kind: 'rendered', width: 2, height: 1 } as const;

  test('accepts the page list of an opened document', () => {
    expect(readRenderReply({ id: 1, kind: 'opened', pageCount: 2, pages: [A4, A4] }, opened)).toEqual({
      id: 1,
      kind: 'opened',
      pageCount: 2,
      pages: [A4, A4],
    });
  });

  // 页数超过上限时渲染页不逐页读大小：主进程按页数拒绝这个文件。
  test('accepts a page count over the limit without page sizes', () => {
    expect(readRenderReply({ id: 1, kind: 'opened', pageCount: 300, pages: [] }, opened)).toMatchObject({
      pageCount: 300,
    });
  });

  test('refuses page lists that do not add up or have impossible sizes', () => {
    const opening = (pageCount: number, pages: unknown[]) => ({ id: 1, kind: 'opened', pageCount, pages });
    expect(readRenderReply(opening(2, [A4]), opened)).toBeNull();
    expect(readRenderReply(opening(1, [{ width: 0, height: 842 }]), opened)).toBeNull();
    expect(readRenderReply(opening(1, [{ width: 20_000, height: 842 }]), opened)).toBeNull();
    expect(readRenderReply(opening(-1, []), opened)).toBeNull();
  });

  test('accepts a bitmap of exactly the size the main process expects', () => {
    const gray = new Uint8Array(2);
    expect(readRenderReply({ id: 2, kind: 'rendered', width: 2, height: 1, gray }, rendered)).toEqual({
      id: 2,
      kind: 'rendered',
      width: 2,
      height: 1,
      gray,
    });
  });

  test('refuses bitmaps of another size or type', () => {
    const bitmap = (width: number, gray: unknown) => ({ id: 2, kind: 'rendered', width, height: 1, gray });
    expect(readRenderReply(bitmap(2, new Uint8Array(3)), rendered)).toBeNull();
    expect(readRenderReply(bitmap(3, new Uint8Array(3)), rendered)).toBeNull();
    expect(readRenderReply(bitmap(2, [0, 0]), rendered)).toBeNull();
  });

  test('passes on known errors with a bounded detail', () => {
    expect(readRenderReply({ id: 2, kind: 'error', error: 'password', detail: 'x'.repeat(600) }, rendered)).toEqual({
      id: 2,
      kind: 'error',
      error: 'password',
      detail: 'x'.repeat(500),
    });
    expect(readRenderReply({ id: 2, kind: 'error', error: 'boom', detail: '' }, rendered)).toBeNull();
  });

  test('refuses replies to another request and non-objects', () => {
    const reply = { id: 3, kind: 'rendered', width: 2, height: 1, gray: new Uint8Array(2) };
    expect(readRenderReply(reply, rendered)).toBeNull();
    expect(readRenderReply('x', rendered)).toBeNull();
  });
});
