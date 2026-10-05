import { describe, expect, test } from 'bun:test';
import { layoutCanvas } from '../templates/canvas-layout';
import { decodeGray } from '../templates/mono-image';
import { PDF_PIECE_TEMPLATE_ID } from './pdf-model';
import { pieceContent, pieceFields, pieceTemplate, shortFileName } from './piece-template';

describe('pieceTemplate', () => {
  test('wraps a bitmap into a one-image canvas template that fills the paper', () => {
    const template = pieceTemplate({ width: 2, height: 1, bits: Uint8Array.of(1, 0) }, { widthMm: 100, heightMm: 150 });
    expect(template).toMatchObject({
      kind: 'canvas',
      id: PDF_PIECE_TEMPLATE_ID,
      paper: { widthMm: 100, heightMm: 150 },
      printer: null,
    });
    expect(template.elements).toHaveLength(1);
    const [image] = template.elements;
    expect(image).toMatchObject({
      kind: 'image',
      x: 0,
      y: 0,
      width: 100,
      height: 150,
      rotation: 0,
      pixelWidth: 2,
      pixelHeight: 1,
      mode: 'threshold',
      threshold: 128,
    });
    if (image?.kind !== 'image') {
      throw new Error('expected an image element');
    }
    expect(decodeGray(image.pixels, 2, 1)?.pixels).toEqual(Uint8Array.of(0, 255));
  });

  // PDF 的一页原样放到纸上，不是按安全边距排出来的：铺满纸不能报「靠近纸边」。
  test('is not checked against the safe margin', () => {
    const template = pieceTemplate({ width: 2, height: 1, bits: Uint8Array.of(1, 0) }, { widthMm: 100, heightMm: 150 });
    const scan = { raw: 'a.pdf 第 1 页第 1 张', ruleId: 'pdf', ruleName: 'PDF 打印', fields: [] };
    expect(layoutCanvas(template, { scan, printedAt: new Date(0), dotMm: 25.4 / 203 }).issues).toEqual([]);
  });
});

describe('piece records', () => {
  test('name the record after the file, the page and the piece', () => {
    expect(pieceContent('面单.pdf', 2, 1)).toBe('面单.pdf 第 2 页第 1 张');
    expect(pieceFields('面单.pdf', 2, 1)).toEqual([
      { name: '文件', value: '面单.pdf' },
      { name: '页码', value: '2' },
      { name: '第几张', value: '1' },
    ]);
  });

  test('shortens very long file names', () => {
    expect([...shortFileName('长'.repeat(150))]).toHaveLength(100);
  });
});
