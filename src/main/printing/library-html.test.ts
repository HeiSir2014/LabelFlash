import { describe, expect, test } from 'bun:test';
import { librarySampleScan } from '../../core/templates/library/library-model';
import { TEMPLATE_LIBRARY } from '../../core/templates/library/template-library';
import { renderCanvasHtml } from './canvas-html';

// 本地时间：{日期} 按本地时区显示（和标签快照一样的理由）。
const PRINTED_AT = new Date(2026, 9, 2, 9, 5).getTime();
/** 热敏标签机常见的两种分辨率：条码模块取整到点之后，两种都要放得下。 */
const DPIS = [203, 300] as const;

describe('template library HTML', () => {
  for (const { template, sample } of TEMPLATE_LIBRARY) {
    // 条码要真的编码（EAN-13 位数、校验位）、二维码要放得进框、号码不被截断：这些只有画的时候才知道。
    test(`${template.name}: prints every barcode, QR code and text of the sample`, () => {
      for (const dpi of DPIS) {
        const rendered = renderCanvasHtml({ scan: librarySampleScan(sample), template, printedAt: PRINTED_AT }, dpi);
        expect({
          dpi,
          issues: rendered.issues,
          diagnostics: rendered.diagnostics,
          overflowCells: rendered.overflowCells,
          barcodeOmitted: rendered.barcodeOmitted,
          qrOmitted: rendered.qrOmitted,
        }).toEqual({ dpi, issues: [], diagnostics: [], overflowCells: 0, barcodeOmitted: false, qrOmitted: false });
      }
    });

    test(`${template.name}: HTML stays the same`, () => {
      const rendered = renderCanvasHtml({ scan: librarySampleScan(sample), template, printedAt: PRINTED_AT });
      expect(rendered.html).toMatchSnapshot();
    });
  }
});
