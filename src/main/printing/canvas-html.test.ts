import { describe, expect, test } from 'bun:test';
import { type CanvasElement, type CanvasTemplate, newCanvasElement } from '../../core/templates/canvas-model';
import { renderCanvasHtml } from './canvas-html';
import { renderLabelHtml } from './label-html';

const PAPER = { widthMm: 60, heightMm: 40 };
const PRINTED_AT = new Date(2026, 9, 1, 9, 5).getTime();
const SCAN = {
  raw: '6901234567892',
  ruleId: 'builtin:raw',
  ruleName: '原样打印',
  fields: [
    { name: '商品码', value: '6901234567892' },
    { name: '品名', value: '<棉T恤>' },
  ],
};

function render(elements: CanvasElement[], dpi = 203) {
  const template: CanvasTemplate = { kind: 'canvas', id: 'custom:c', name: 'c', paper: PAPER, printer: null, elements };
  return renderCanvasHtml({ scan: SCAN, template, printedAt: PRINTED_AT }, dpi);
}

function element<K extends CanvasElement['kind']>(kind: K, overrides: object = {}): CanvasElement {
  return { ...newCanvasElement(kind, `${kind}1`, PAPER), x: 5, y: 5, ...overrides } as CanvasElement;
}

describe('renderCanvasHtml', () => {
  test('sets the page to the template paper', () => {
    expect(render([]).html).toContain('@page { size: 60mm 40mm; margin: 0; }');
  });

  test('escapes text from the scan', () => {
    const { html } = render([element('text', { text: '{品名}' })]);
    expect(html).toContain('&lt;棉T恤&gt;');
    expect(html).not.toContain('<棉T恤>');
  });

  test('draws an EAN-13 barcode with its number underneath', () => {
    const { html, issues } = render([
      element('barcode', { symbology: 'ean13', value: '{商品码}', width: 40, height: 15 }),
    ]);
    expect(issues).toEqual([]);
    expect(html).toContain('shape-rendering="crispEdges"');
    expect(html).toContain('>6901234567892</div>');
  });

  test('leaves out a barcode whose content does not fit the symbology and says why', () => {
    const { html, issues, barcodeOmitted } = render([
      element('barcode', { name: '商品码', symbology: 'ean13', value: '{品名}' }),
    ]);
    expect(barcodeOmitted).toBe(true);
    expect(issues[0]).toStartWith('条码「商品码」');
    expect(html).not.toContain('crispEdges');
  });

  test('turns an element by 90 degrees around whole dots', () => {
    const { html } = render([element('text', { text: 'A', width: 5, height: 20, rotation: 90 })]);
    expect(html).toMatch(/transform:translate\([\d.]+mm,0mm\) rotate\(90deg\)/);
  });

  test('draws an image as a 1-bit bitmap, one pixel per printer dot', () => {
    // 2×1：左黑右白。
    const { html } = render([
      element('image', { pixels: 'AP8=', pixelWidth: 2, pixelHeight: 1, width: 10, height: 5 }),
    ]);
    expect(html).toContain('src="data:image/bmp;base64,');
    expect(html).toContain('image-rendering:pixelated');
  });

  test('draws a filled rectangle and a dashed line', () => {
    const { html } = render([
      element('rect', { filled: true }),
      element('line', { dashed: true, width: 30, height: 0.25 }),
    ]);
    expect(html).toContain('background:#000');
    expect(html).toContain('repeating-linear-gradient(90deg');
  });

  test('is what renderLabelHtml returns for a canvas template', () => {
    const template: CanvasTemplate = {
      kind: 'canvas',
      id: 'custom:c',
      name: 'c',
      paper: PAPER,
      printer: null,
      elements: [element('text', { text: 'A' })],
    };
    const job = { scan: SCAN, template, printedAt: PRINTED_AT };
    expect(renderLabelHtml(job, 300)).toEqual(renderCanvasHtml(job, 300));
  });
});
