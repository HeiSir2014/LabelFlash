import { describe, expect, test } from 'bun:test';
import type { ScanField } from '../../core/scan/scan-result';
import {
  BUILT_IN_WAYBILLS,
  PLATFORM_ONE_PART,
  PLATFORM_TWO_PART,
  WAYBILL_SAMPLE_FIELDS,
} from '../../core/templates/builtin-waybills';
import type { WaybillNode, WaybillTemplate } from '../../core/templates/waybill-model';
import { renderLabelHtml } from './label-html';
import { renderWaybillHtml } from './waybill-html';

const PRINTED_AT = new Date(2026, 9, 1, 14, 30).getTime();

function render(template: WaybillTemplate, fields: readonly ScanField[] = WAYBILL_SAMPLE_FIELDS, dpi = 203) {
  return renderWaybillHtml(
    { scan: { raw: 'api', ruleId: 'api', ruleName: '本机接口', fields: [...fields] }, template, printedAt: PRINTED_AT },
    dpi,
  );
}

function withField(name: string, value: string): ScanField[] {
  return WAYBILL_SAMPLE_FIELDS.map((field) => (field.name === name ? { ...field, value } : field));
}

function single(content: WaybillNode['body'], heightMm = 20): WaybillTemplate {
  return {
    ...PLATFORM_TWO_PART,
    paper: { widthMm: 100, heightMm },
    root: {
      sizeMm: 0,
      ruleAfter: 'none',
      body: { split: 'rows', children: [{ sizeMm: 0, ruleAfter: 'solid', body: content }] },
    },
  };
}

describe('renderWaybillHtml', () => {
  test('sets the page to the template paper with no margins', () => {
    expect(render(PLATFORM_ONE_PART).html).toContain('@page { size: 76mm 130mm; margin: 0; }');
  });

  test('prints every field of the sample data and escapes it', () => {
    const { html } = render(PLATFORM_TWO_PART, withField('收件人', '<张三>'));
    expect(html).toContain('&lt;张三&gt;');
    expect(html).not.toContain('<张三>');
    expect(html).toContain('杭州转运中心');
  });

  test('names the print job after the waybill number', () => {
    expect(render(PLATFORM_TWO_PART).html).toContain('<title>781234567890123</title>');
  });

  test('draws the inverse marks with a black background and white text', () => {
    const { html } = render(PLATFORM_TWO_PART);
    expect(html).toContain('<div class="ink"></div><div class="text text--middle text--inverse"');
  });

  test('renders the barcode with the number underneath', () => {
    const { html, barcodeOmitted } = render(PLATFORM_TWO_PART);
    expect(barcodeOmitted).toBe(false);
    expect(html).toContain('shape-rendering="crispEdges"');
    expect(html).toContain('<div class="code__text"');
  });

  test('omits a barcode that cannot be encoded and says so', () => {
    const { html, barcodeOmitted } = render(PLATFORM_TWO_PART, withField('运单号', '运单一二三'));
    expect(barcodeOmitted).toBe(true);
    expect(html).not.toContain('class="code__text"');
  });

  test('omits a barcode that does not fit at the minimum module width', () => {
    const narrow = single({
      content: { kind: 'barcode', value: '{运单号}', showText: true, textSizeMm: 3, vertical: false },
    });
    const tiny = { ...narrow, paper: { widthMm: 30, heightMm: 20 } };
    expect(render(tiny).barcodeOmitted).toBe(true);
  });

  test('turns a vertical barcode on its side without the number', () => {
    const { html } = render(PLATFORM_ONE_PART);
    expect(html).toMatch(/viewBox="0 0 1 \d+"/);
  });

  test('prints nothing for a field that was not sent', () => {
    const { html } = render(
      PLATFORM_TWO_PART,
      WAYBILL_SAMPLE_FIELDS.filter((field) => field.name !== '集包地'),
    );
    expect(html).not.toContain('杭州转运中心');
  });

  test('reports truncated cells', () => {
    const { overflowCells } = render(PLATFORM_ONE_PART, withField('收件地址', '很长很长的收件地址'.repeat(30)));
    expect(overflowCells).toBeGreaterThan(0);
  });

  test('renders all built-in waybills cleanly with the sample data', () => {
    for (const template of BUILT_IN_WAYBILLS) {
      const result = render(template);
      expect([result.overflowCells, result.barcodeOmitted, result.qrOmitted]).toEqual([0, false, false]);
    }
  });

  test('is what renderLabelHtml returns for a waybill template', () => {
    const job = {
      scan: { raw: 'api', ruleId: 'api', ruleName: '本机接口', fields: [...WAYBILL_SAMPLE_FIELDS] },
      template: PLATFORM_TWO_PART,
      printedAt: PRINTED_AT,
    };
    expect(renderLabelHtml(job, 300)).toEqual(renderWaybillHtml(job, 300));
  });
});

// 内置面单的版式改了要有意识地改：快照记下每一格的位置、字号和换行。
describe('built-in waybill HTML stays the same', () => {
  for (const template of BUILT_IN_WAYBILLS) {
    test(template.name, () => {
      expect(render(template).html).toMatchSnapshot();
    });
  }
});
