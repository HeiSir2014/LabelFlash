import { describe, expect, test } from 'bun:test';
import { paperDots } from '../../core/pdf/piece-fit';
import { pieceTemplate } from '../../core/pdf/piece-template';
import {
  type CanvasElement,
  type CanvasTableCell,
  type CanvasTemplate,
  newCanvasElement,
  snapBorderDots,
} from '../../core/templates/canvas-model';
import { monoBmp } from '../../core/templates/mono-image';
import { renderWarningTexts } from '../../shared/render-warnings';
import { renderCanvasHtml } from './canvas-html';
import { mm } from './html-text';
import { renderLabelHtml } from './label-html';

const DOT = 25.4 / 203;
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

function cellOf(text: string): CanvasTableCell {
  return { text, fontSizeMm: 2.8, bold: false, align: 'left' };
}

function onDot(valueMm: number): boolean {
  // 容差放宽到 1e-3 个点：这个值是从 mm() 四舍五入到 3 位小数的字符串反推出来的（例如拿画出来的总宽除以模块数），
  // 除法本身会引入比浮点噪声大一点的误差，比 1e-6 更紧的容差会把真正落在点上的值也判成不在。
  return Math.abs(valueMm / DOT - Math.round(valueMm / DOT)) < 1e-3;
}

describe('renderCanvasHtml', () => {
  test('sets the page to the template paper', () => {
    expect(render([]).html).toContain('@page { size: 60mm 40mm; margin: 0; }');
  });

  test('marks each element with its id, so the designer can hide it on the canvas only', () => {
    expect(render([element('text', { text: 'A' })]).html).toContain('<div class="el" data-element-id="text1"');
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

  test('turns an element by 180 degrees, translating by its own snapped width and height', () => {
    const { html } = render([element('text', { text: 'A', width: 5, height: 20, rotation: 180 })]);
    // 180° 不转置宽高：平移量正好是这个元素自己的框宽、框高（整数个点）。
    expect(html).toMatch(/transform:translate\(([\d.]+)mm,([\d.]+)mm\) rotate\(180deg\)/);
    const match = html.match(
      /<div class="frame" style="width:([\d.]+)mm;height:([\d.]+)mm;transform:translate\(([\d.]+)mm,([\d.]+)mm\) rotate\(180deg\)"/,
    );
    if (!match) throw new Error('expected a rotated frame');
    const [, width, height, tx, ty] = match;
    expect(tx).toBe(width);
    expect(ty).toBe(height);
  });

  test('turns an element by 270 degrees, translating only on the y axis', () => {
    const { html } = render([element('text', { text: 'A', width: 5, height: 20, rotation: 270 })]);
    expect(html).toMatch(/transform:translate\(0mm,[\d.]+mm\) rotate\(270deg\)/);
  });

  test('draws a Data Matrix barcode with a whole number of printer dots per module', () => {
    const { html, issues } = render([
      element('barcode', { symbology: 'datamatrix', value: '{商品码}', width: 20, height: 20 }),
    ]);
    expect(issues).toEqual([]);
    const match = html.match(
      /viewBox="0 0 (\d+) (\d+)" shape-rendering="crispEdges" style="width:([\d.]+)mm;height:([\d.]+)mm"/,
    );
    if (!match) throw new Error('expected a Data Matrix svg');
    const [, columns, rows, widthMm, heightMm] = match;
    expect(onDot(Number(widthMm) / Number(columns))).toBe(true);
    expect(onDot(Number(heightMm) / Number(rows))).toBe(true);
  });

  test('draws a PDF417 barcode with a whole number of printer dots per module', () => {
    const { html, issues } = render([
      element('barcode', { symbology: 'pdf417', value: '{商品码}', width: 40, height: 20 }),
    ]);
    expect(issues).toEqual([]);
    const match = html.match(
      /viewBox="0 0 (\d+) (\d+)" shape-rendering="crispEdges" style="width:([\d.]+)mm;height:([\d.]+)mm"/,
    );
    if (!match) throw new Error('expected a PDF417 svg');
    const [, columns, rows, widthMm, heightMm] = match;
    expect(onDot(Number(widthMm) / Number(columns))).toBe(true);
    expect(onDot(Number(heightMm) / Number(rows))).toBe(true);
  });

  test('omits a QR code that is too long for its frame and reports why', () => {
    const { qrOmitted, issues, html } = render([
      element('qr', { name: '二维码A', value: '很长的内容'.repeat(200), width: 5, height: 5 }),
    ]);
    expect(qrOmitted).toBe(true);
    expect(issues).toContain('二维码「二维码A」不印：内容太长、框太小');
    expect(html).not.toContain('<path');
  });

  test('leaves out a barcode whose module would be narrower than the minimum and says how wide it must be', () => {
    const { issues, barcodeOmitted, elements } = render([
      element('barcode', { name: '窄', symbology: 'code128', value: '{商品码}', width: 3, height: 10 }),
    ]);
    expect(barcodeOmitted).toBe(true);
    const warning = elements[0];
    expect(warning).toMatchObject({ elementId: 'barcode1', level: 'omitted', short: '条码不印：框不够宽' });
    expect(issues).toEqual([`条码「窄」不印：内容 6901234567892 至少要 ${warning?.minWidthMm}mm 宽（现在 3mm）`]);
    expect(warning?.text).toBe(issues[0]);
  });

  // 最小宽度要和画条码用同一套取整到点的规则：填成这个宽度，元素无论落在哪个小数位置都印得出；
  // 再窄 0.3mm（比取整的余量多）就印不出。两种分辨率的打印点不同，各算各的。
  test.each([203, 300])('gives a minimum barcode width that always prints at %i dpi', (dpi) => {
    const narrow = render([element('barcode', { symbology: 'code128', value: '{商品码}', width: 3, height: 10 })], dpi);
    const minWidthMm = narrow.elements[0]?.minWidthMm ?? 0;
    expect(minWidthMm).toBeGreaterThan(3);
    for (const x of [5, 5.03, 5.07, 5.1, 5.12]) {
      const fits = render(
        [element('barcode', { symbology: 'code128', value: '{商品码}', x, width: minWidthMm, height: 10 })],
        dpi,
      );
      expect(fits.barcodeOmitted).toBe(false);
      const tooNarrow = render(
        [element('barcode', { symbology: 'code128', value: '{商品码}', x, width: minWidthMm - 0.3, height: 10 })],
        dpi,
      );
      expect(tooNarrow.barcodeOmitted).toBe(true);
    }
  });

  test('gives the minimum as a height for a barcode turned by 90 degrees', () => {
    const { elements } = render([
      element('barcode', { symbology: 'code128', value: '{商品码}', width: 10, height: 3, rotation: 90 }),
    ]);
    expect(elements[0]?.minWidthMm).toBeNull();
    expect(elements[0]?.minHeightMm).toBeGreaterThan(3);
  });

  test('warns, without a print issue, when a barcode is within 10% of its minimum width', () => {
    const minWidthMm =
      render([element('barcode', { symbology: 'code128', value: '{商品码}', width: 3, height: 10 })]).elements[0]
        ?.minWidthMm ?? 0;
    const tight = render([
      element('barcode', { name: '紧', symbology: 'code128', value: '{商品码}', width: minWidthMm + 0.5, height: 10 }),
    ]);
    expect(tight.barcodeOmitted).toBe(false);
    expect(tight.issues).toEqual([]);
    expect(tight.elements).toEqual([
      {
        elementId: 'barcode1',
        level: 'warning',
        text: `条码「紧」只比最小宽度宽一点：内容再长一些就印不出（至少要 ${minWidthMm}mm 宽）`,
        short: null,
        minWidthMm,
        minHeightMm: null,
      },
    ]);
    const roomy = render([
      element('barcode', { symbology: 'code128', value: '{商品码}', width: minWidthMm * 1.2, height: 10 }),
    ]);
    expect(roomy.elements).toEqual([]);
  });

  test('gives the minimum height of a barcode that is too short', () => {
    const { elements } = render([
      element('barcode', { symbology: 'code128', value: '{商品码}', showText: false, width: 40, height: 3 }),
    ]);
    expect(elements[0]).toMatchObject({ level: 'omitted', short: '条码不印：太矮', minWidthMm: null });
    const minHeightMm = elements[0]?.minHeightMm ?? 0;
    const fits = render([
      element('barcode', { symbology: 'code128', value: '{商品码}', showText: false, width: 40, height: minHeightMm }),
    ]);
    expect(fits.barcodeOmitted).toBe(false);
  });

  test('ties every print issue to an element', () => {
    const { issues, elements } = render([
      element('barcode', { symbology: 'ean13', value: '{品名}' }),
      element('qr', { value: 'x'.repeat(200), width: 3, height: 3 }),
      element('text', { text: '很长'.repeat(50), width: 5, height: 2, x: 0.5 }),
    ]);
    expect(issues.length).toBeGreaterThan(2);
    const omitted = elements.filter((warning) => warning.level === 'omitted');
    expect(omitted.map((warning) => warning.short)).toEqual([
      '条码不印：有这种条码不能编的字',
      '二维码不印：内容太长、框太小',
    ]);
    expect(issues.every((issue) => elements.some((warning) => warning.text === issue))).toBe(true);
  });

  test('leaves out a barcode whose bars would be too short to scan and says so', () => {
    const { issues, barcodeOmitted } = render([
      element('barcode', {
        name: '矮',
        symbology: 'code128',
        value: '{商品码}',
        showText: false,
        width: 40,
        height: 3,
      }),
    ]);
    expect(barcodeOmitted).toBe(true);
    expect(issues).toContain('条码「矮」不印：太矮（条高不到 4mm）');
  });

  test('escapes the number printed under a Code 128 barcode', () => {
    const { html, issues } = render([
      element('barcode', { symbology: 'code128', value: 'A<B&C', width: 40, height: 15 }),
    ]);
    expect(issues).toEqual([]);
    expect(html).toContain('>A&lt;B&amp;C<');
    expect(html).not.toContain('>A<B&C<');
  });

  test('reports a barcode number that is wider than its frame as truncated and counts it', () => {
    const { issues, overflowCells } = render([
      element('barcode', {
        name: '长号',
        symbology: 'code128',
        value: '{商品码}',
        textSizeMm: 14,
        width: 40,
        height: 25,
      }),
    ]);
    expect(overflowCells).toBeGreaterThan(0);
    expect(issues).toContain('条码「长号」下面的号码放不下，已截断');
  });

  test('reports a barcode number at about 99% of its frame width as truncated', () => {
    // 13 位数字按字宽表估算约 39.66mm，40mm 的框取整到打印点后约 40.04mm：号码比框窄，但窄不过 2%
    // 的余量（LINE_WIDTH_SLACK）——号码总是加粗显示，字宽表却是按不加粗估的，这 2% 正是用来兜住
    // 这类估算误差，不加这道折扣就会把印不全的号码当成印得下。
    const { issues, overflowCells } = render([
      element('barcode', {
        name: '号码',
        symbology: 'code128',
        value: '{商品码}',
        textSizeMm: 4.8,
        width: 40,
        height: 25,
        x: 0,
        y: 0,
      }),
    ]);
    expect(overflowCells).toBeGreaterThan(0);
    expect(issues).toContain('条码「号码」下面的号码放不下，已截断');
  });

  test('leaves at least two quiet-zone modules on each side of a canvas QR code', () => {
    const { html } = render([element('qr', { value: 'A001', width: 15, height: 15 })]);
    const codeMatch = html.match(
      /<div class="code" style="left:([\d.]+)mm;top:([\d.]+)mm;width:([\d.]+)mm;height:([\d.]+)mm">/,
    );
    const viewBoxMatch = html.match(/viewBox="0 0 (\d+) \d+"/);
    if (!codeMatch || !viewBoxMatch) throw new Error('expected a QR code');
    const [, left] = codeMatch;
    const moduleCount = Number(viewBoxMatch[1]);
    const plan = html.match(/width:([\d.]+)mm;height:[\d.]+mm">(?:(?!<\/div>).)*<svg width="100%"/);
    const qrWidthMm = plan ? Number(plan[1]) : null;
    if (qrWidthMm === null) throw new Error('expected the QR code box size');
    const moduleMm = qrWidthMm / moduleCount;
    expect(Number(left)).toBeGreaterThanOrEqual(moduleMm * 2 - 1e-3);
  });

  test('draws inverse text with a black background and white text', () => {
    const { html } = render([element('text', { text: 'A', inverse: true })]);
    expect(html).toContain(';background:#000;color:#fff"');
  });

  test('uses the border thickness as the cell padding when the border is thicker than the default', () => {
    const borderDots = snapBorderDots(1.5, DOT);
    const borderMm = borderDots * DOT;
    const table = element('table', {
      width: 30,
      height: 10,
      borderMm: 1.5,
      columnsMm: [15, 15],
      rowsMm: [5, 5],
      cells: [
        [cellOf('A'), cellOf('B')],
        [cellOf('C'), cellOf('D')],
      ],
    });
    const { html } = render([table]);
    expect(html).toContain(`left:${mm(borderMm)};top:${mm(borderMm)}`);
  });

  test('clamps a table cell text box to zero instead of a negative size when the border eats the whole cell', () => {
    const table = element('table', {
      width: 4,
      height: 4,
      borderMm: 2,
      columnsMm: [2, 2],
      rowsMm: [2, 2],
      cells: [
        [cellOf('A'), cellOf('B')],
        [cellOf('C'), cellOf('D')],
      ],
    });
    const { html } = render([table]);
    expect(html).not.toMatch(/width:-[\d.]+mm/);
    expect(html).not.toMatch(/height:-[\d.]+mm/);
  });

  test('centers an image on whole printer dots', () => {
    const { html } = render([
      element('image', { pixels: 'AP8=', pixelWidth: 2, pixelHeight: 1, width: 10, height: 5 }),
    ]);
    const match = html.match(
      /<img class="dots" alt="" src="data:image\/bmp;base64,[^"]+" style="left:([\d.]+)mm;top:([\d.]+)mm;/,
    );
    if (!match) throw new Error('expected an image element');
    const [, left, top] = match;
    expect(onDot(Number(left))).toBe(true);
    expect(onDot(Number(top))).toBe(true);
  });

  test('reports a damaged image and draws nothing for it', () => {
    const { html, issues } = render([
      element('image', { name: '图片A', pixels: 'AA==', pixelWidth: 2, pixelHeight: 2 }),
    ]);
    expect(issues).toContain('图片「图片A」不印：数据坏了');
    expect(html).not.toContain('<img');
  });

  test('pairs with renderWarningTexts: an EAN-13 barcode with non-ASCII content produces exactly one warning text', () => {
    const rendered = render([element('barcode', { name: '商品码', symbology: 'ean13', value: '{品名}' })]);
    expect(renderWarningTexts(rendered)).toHaveLength(1);
  });
});

describe('PDF pieces', () => {
  // 黑白位图按这台打印机的点做好，包进自由设计模板后不能再被缩放或重新转黑白：打出来的点和预览一模一样。
  test('prints a PDF piece dot for dot', () => {
    const paper = { widthMm: 60, heightMm: 40 };
    const dots = paperDots(paper, 203);
    const bits = new Uint8Array(dots.width * dots.height).map((_, index) => (index % 3 === 0 ? 1 : 0));
    const rendered = renderCanvasHtml(
      {
        scan: { raw: 'x.pdf 第 1 页第 1 张', ruleId: 'pdf', ruleName: 'PDF 打印', fields: [] },
        template: pieceTemplate({ width: dots.width, height: dots.height, bits }, paper),
        printedAt: 0,
      },
      203,
    );
    expect(rendered.html).toContain(monoBmp(bits, dots.width, dots.height));
    expect(renderWarningTexts(rendered)).toEqual([]);
  });
});
