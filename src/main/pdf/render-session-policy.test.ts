import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isAllowedRenderRequest, PDF_RENDER_CSP, RENDER_PARTITIONS } from './render-session-policy';

describe('PDF_RENDER_CSP', () => {
  // 页面的 meta 管页面，响应头管 worker：两份不一致时会有一边比另一边松。
  test('is the same policy the render page declares in its meta tag', async () => {
    const html = await readFile(join(import.meta.dir, '../../renderer/pdf-render.html'), 'utf8');
    const meta = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html)?.[1];
    expect(meta).toBe(PDF_RENDER_CSP);
  });

  test('allows no script evaluation besides compiling WebAssembly', () => {
    expect(PDF_RENDER_CSP).not.toContain("'unsafe-eval'");
    expect(PDF_RENDER_CSP).toContain("default-src 'none'");
  });
});

describe('isAllowedRenderRequest', () => {
  test('lets the render page read only files of the app', () => {
    expect(isAllowedRenderRequest('app://bundle/pdfjs/cmaps/UniGB-UCS2-H.bcmap', null)).toBe(true);
    expect(isAllowedRenderRequest('app://other/x', null)).toBe(false);
    expect(isAllowedRenderRequest('https://example.com/a.js', null)).toBe(false);
    expect(isAllowedRenderRequest('file:///C:/Windows/win.ini', null)).toBe(false);
    expect(isAllowedRenderRequest('not a url', null)).toBe(false);
  });

  test('allows fonts and images that pdf.js builds in the page', () => {
    expect(isAllowedRenderRequest('data:font/ttf;base64,AAAA', null)).toBe(true);
    expect(isAllowedRenderRequest('blob:app://bundle/1234', null)).toBe(true);
  });

  test('allows the local dev server only in the dev build', () => {
    expect(isAllowedRenderRequest('http://localhost:5173/pdf-render.html', 'http://localhost:5173')).toBe(true);
    expect(isAllowedRenderRequest('ws://localhost:5173/', 'http://localhost:5173')).toBe(true);
    expect(isAllowedRenderRequest('http://localhost:5174/x', 'http://localhost:5173')).toBe(false);
    expect(isAllowedRenderRequest('http://localhost:5173/pdf-render.html', null)).toBe(false);
  });
});

describe('RENDER_PARTITIONS', () => {
  // 局域网别的电脑交来的文档和操作员自己选的 PDF 不在同一个会话（也就不在同一个渲染进程）里打开。
  test('gives LAN sharing its own in-memory session apart from PDF printing', () => {
    expect(RENDER_PARTITIONS.ipp).not.toBe(RENDER_PARTITIONS.pdf);
    for (const partition of Object.values(RENDER_PARTITIONS)) {
      expect(partition.startsWith('persist:')).toBe(false);
    }
  });
});
