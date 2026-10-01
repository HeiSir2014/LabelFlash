import { describe, expect, test } from 'bun:test';
import type { ScanResult } from '../scan/scan-result';
import { BUILT_IN_WAYBILLS, PLATFORM_TWO_PART, WAYBILL_SAMPLE_FIELDS } from './builtin-waybills';
import { LINE_HEIGHT } from './text-fit';
import {
  CELL_PADDING_MM,
  expandParagraph,
  fitParagraphs,
  type LaidCell,
  layoutWaybill,
  resolveSizes,
  textWidthMm,
  wrapText,
} from './waybill-layout';
import type { WaybillNode, WaybillTemplate } from './waybill-model';

/** 203dpi 一个点的毫米数。 */
const DOT_203 = 25.4 / 203;
const PRINTED_AT = new Date(2026, 9, 1, 14, 30);

function scanOf(fields: Record<string, string>): ScanResult {
  return {
    raw: 'api',
    ruleId: 'api',
    ruleName: '本机接口',
    fields: Object.entries(fields).map(([name, value]) => ({ name, value })),
  };
}

const SAMPLE = scanOf(Object.fromEntries(WAYBILL_SAMPLE_FIELDS.map((field) => [field.name, field.value])));

function text(sizeMm: number, value: string, options: Partial<WaybillNode> = {}): WaybillNode {
  return {
    sizeMm,
    ruleAfter: 'solid',
    body: {
      content: {
        kind: 'text',
        paragraphs: [{ text: value, fontSizeMm: 3, bold: false, wrap: true }],
        align: 'left',
        valign: 'middle',
        inverse: false,
      },
    },
    ...options,
  };
}

function waybillOf(children: WaybillNode[], overrides: Partial<WaybillTemplate> = {}): WaybillTemplate {
  return {
    kind: 'waybill',
    id: 'custom:w',
    name: '测试面单',
    paper: { widthMm: 100, heightMm: 50 },
    printer: null,
    marginsMm: { top: 0, right: 0, bottom: 0, left: 0 },
    lineWidthMm: 0.3,
    root: { sizeMm: 0, ruleAfter: 'none', body: { split: 'rows', children } },
    ...overrides,
  };
}

function layout(template: WaybillTemplate, scan: ScanResult = SAMPLE, dotMm = DOT_203) {
  return layoutWaybill(template, { scan, printedAt: PRINTED_AT, dotMm });
}

function textLines(cell: LaidCell | undefined): string[] {
  return cell?.content.kind === 'text' ? cell.content.lines.map((line) => line.text) : [];
}

describe('resolveSizes', () => {
  test('gives the last child whatever is left', () => {
    expect(resolveSizes([15, 20, 0], 100)).toEqual([15, 20, 65]);
  });

  test('shrinks the fixed children proportionally when they do not leave room for the last one', () => {
    const sizes = resolveSizes([60, 60, 0], 100);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(100);
    expect(sizes[0]).toBeCloseTo(sizes[1] ?? 0);
    expect(sizes[2]).toBe(1);
  });

  test('always adds up to the parent', () => {
    for (const total of [3, 37.5, 180]) {
      const sizes = resolveSizes([10, 0.2, 30, 0], total);
      expect(sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(total);
    }
  });
});

describe('layoutWaybill geometry', () => {
  test('tiles the page exactly: rows stack without gaps and each row is as wide as the page', () => {
    const template = waybillOf([text(15, 'a'), text(20, 'b'), text(0, 'c')]);
    const { cells } = layout(template);
    const ys = cells.map((cell) => [cell.rect.y, cell.rect.y + cell.rect.height]);
    expect(ys[0]?.[0]).toBe(0);
    expect(ys[0]?.[1]).toBeCloseTo(ys[1]?.[0] ?? -1);
    expect(ys[1]?.[1]).toBeCloseTo(ys[2]?.[0] ?? -1);
    expect(ys[2]?.[1]).toBeCloseTo(Math.round(50 / DOT_203) * DOT_203);
    for (const cell of cells) {
      expect(cell.rect.width).toBeCloseTo(Math.round(100 / DOT_203) * DOT_203);
    }
  });

  test('puts every edge and line on whole printer dots', () => {
    const { cells, rules } = layout(PLATFORM_TWO_PART);
    const onDot = (mm: number) => Math.abs(mm / DOT_203 - Math.round(mm / DOT_203)) < 1e-6;
    for (const { rect } of [...cells, ...rules]) {
      expect([rect.x, rect.y, rect.width, rect.height].every(onDot)).toBe(true);
    }
  });

  test('shares the boundary between neighbours in different branches', () => {
    // 两行各自再左右分，第一格都是 30mm：两行的竖线落在同一个点上。
    const row = (): WaybillNode => ({
      sizeMm: 20,
      ruleAfter: 'solid',
      body: { split: 'columns', children: [text(30.03, 'a'), text(0, 'b')] },
    });
    const { rules } = layout(waybillOf([row(), { ...row(), sizeMm: 0 }]));
    const vertical = rules.filter((rule) => rule.orientation === 'vertical').map((rule) => rule.rect.x);
    expect(vertical).toHaveLength(2);
    expect(vertical[0]).toBe(vertical[1] ?? -1);
  });

  test('draws a line only between siblings, centred on the boundary, as long as the parent', () => {
    const template = waybillOf(
      [text(10, 'a'), text(10, 'b', { ruleAfter: 'dashed' }), text(0, 'c', { ruleAfter: 'solid' })],
      {
        lineWidthMm: 0.3,
      },
    );
    const { rules } = layout(template);
    expect(rules.map((rule) => rule.style)).toEqual(['solid', 'dashed']);
    const first = rules[0];
    expect(first?.rect.width).toBeCloseTo(Math.round(100 / DOT_203) * DOT_203);
    // 0.3mm 在 203dpi 上取整成 2 个点，以 10mm 处的边界为中心。
    expect(first?.rect.height).toBeCloseTo(2 * DOT_203);
    expect((first?.rect.y ?? 0) + DOT_203).toBeCloseTo(Math.round(10 / DOT_203) * DOT_203);
  });

  test('skips the line when the sibling says none', () => {
    const { rules } = layout(waybillOf([text(10, 'a', { ruleAfter: 'none' }), text(0, 'b')]));
    expect(rules).toEqual([]);
  });

  test('keeps lines at least 0.25mm thick on high-resolution output', () => {
    const dot1200 = 25.4 / 1200;
    const { rules } = layout(waybillOf([text(10, 'a'), text(0, 'b')], { lineWidthMm: 0.2 }), SAMPLE, dot1200);
    expect(rules[0]?.rect.height ?? 0).toBeGreaterThanOrEqual(0.25 - dot1200);
  });

  test('lets the last row absorb a paper change', () => {
    const shorter = { ...PLATFORM_TWO_PART, paper: { widthMm: 100, heightMm: 150 } };
    const { cells } = layout(shorter);
    const bottom = Math.max(...cells.map((cell) => cell.rect.y + cell.rect.height));
    expect(bottom).toBeCloseTo(Math.round(150 / DOT_203) * DOT_203);
  });

  test('lays out every built-in waybill with the sample data without truncating anything', () => {
    for (const template of BUILT_IN_WAYBILLS) {
      expect(layout(template).overflowCells).toBe(0);
    }
  });
});

describe('paragraphs', () => {
  test('drops a paragraph whose fields are all empty', () => {
    const context = { scan: scanOf({ 代收货款: '' }), printedAt: PRINTED_AT };
    expect(expandParagraph('代收货款：{代收货款}', context)).toBeNull();
  });

  test('keeps a paragraph when some of its fields have values', () => {
    const context = { scan: scanOf({ 收件人: '张三' }), printedAt: PRINTED_AT };
    expect(expandParagraph('{收件人}  {收件电话}', context)).toBe('张三  ');
  });

  test('keeps fixed text and fixed variables', () => {
    const context = { scan: scanOf({}), printedAt: PRINTED_AT };
    expect(expandParagraph('签收栏', context)).toBe('签收栏');
    expect(expandParagraph('{日期}', context)).toBe('2026-10-01');
  });

  test('prints nothing in a cell whose only paragraph is dropped', () => {
    const { cells } = layout(waybillOf([text(10, '{代收货款}'), text(0, 'x')]), scanOf({}));
    expect(textLines(cells[0])).toEqual([]);
  });
});

describe('wrapText', () => {
  test('keeps Latin letters and digits together', () => {
    const lines = wrapText('收货 SF1234567890123', textWidthMm('SF1234567890123', 3), 3);
    expect(lines).toEqual(['收货', 'SF1234567890123']);
  });

  test('never starts a line with closing punctuation', () => {
    const width = textWidthMm('一二三四', 3);
    const lines = wrapText('一二三四，五六', width, 3);
    expect(lines.every((line) => !line.startsWith('，'))).toBe(true);
  });

  test('breaks a token longer than a whole line character by character', () => {
    const width = textWidthMm('12345', 3);
    const lines = wrapText('1234567890123', width, 3);
    expect(lines.join('')).toBe('1234567890123');
    expect(lines.every((line) => textWidthMm(line, 3) <= width + 1e-9)).toBe(true);
  });

  test('honours line breaks inside a field value and drops blank lines', () => {
    expect(wrapText('第一行\n\n第二行', 100, 3)).toEqual(['第一行', '第二行']);
  });
});

describe('fitParagraphs', () => {
  const paragraph = (value: string, wrap = true) => ({ text: value, fontSizeMm: 4, bold: false, wrap });

  test('keeps the template size when it fits', () => {
    const fitted = fitParagraphs([paragraph('张三')], 40, 10);
    expect(fitted.lines).toEqual([{ text: '张三', fontSizeMm: 4, bold: false }]);
    expect(fitted.overflow).toBe(false);
  });

  test('shrinks a single-line paragraph instead of wrapping it', () => {
    const value = '531-A03 12 531-A03 12';
    const fitted = fitParagraphs([paragraph(value, false)], textWidthMm(value, 4) * 0.8, 10);
    expect(fitted.lines).toHaveLength(1);
    expect(fitted.lines[0]?.fontSizeMm).toBeLessThan(4);
    expect(fitted.overflow).toBe(false);
  });

  test('shrinks every paragraph of the cell together', () => {
    const fitted = fitParagraphs([paragraph('第一段'), paragraph('第二段')], 40, 4 * LINE_HEIGHT * 2 * 0.8);
    expect(new Set(fitted.lines.map((line) => line.fontSizeMm)).size).toBe(1);
    expect(fitted.lines[0]?.fontSizeMm).toBeLessThan(4);
  });

  test('truncates with an ellipsis and reports overflow when even the smallest size does not fit', () => {
    const fitted = fitParagraphs([paragraph('很长的地址'.repeat(20))], 30, 4);
    expect(fitted.overflow).toBe(true);
    expect(fitted.lines.at(-1)?.text.endsWith('…')).toBe(true);
    expect(fitted.lines.every((line) => textWidthMm(line.text, line.fontSizeMm) <= 30 + 1e-9)).toBe(true);
  });

  test('never goes below 60% of the template size', () => {
    const fitted = fitParagraphs([paragraph('很长的地址'.repeat(20))], 30, 4);
    expect(fitted.lines.every((line) => line.fontSizeMm >= 4 * 0.6 - 0.1)).toBe(true);
  });

  test('fits text inside the cell padding', () => {
    const { cells } = layout(waybillOf([text(10, '{收件地址}'), text(0, 'x')]));
    const cell = cells[0];
    if (cell?.content.kind !== 'text') throw new Error('expected text');
    const innerWidth = cell.rect.width - 2 * CELL_PADDING_MM.x;
    expect(cell.content.lines.every((line) => textWidthMm(line.text, line.fontSizeMm) <= innerWidth + 1e-9)).toBe(true);
  });
});
