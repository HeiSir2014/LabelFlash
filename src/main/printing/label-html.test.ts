import { describe, expect, test } from 'bun:test';
import { MAX_RAW_LENGTH } from '../../core/label-parser';
import { BUILT_IN_TEMPLATES, STANDARD_TEMPLATE } from '../../core/templates/builtin-templates';
import type { LabelTemplate } from '../../core/templates/template-model';
import { escapeHtml, renderLabelHtml } from './label-html';

const LABEL = { raw: 'CL5640-TK-图片色-XL', code: 'CL5640-TK', color: '图片色', size: 'XL' };
const PRINTED_AT = new Date(2026, 8, 28, 9, 5).getTime();

function render(template: LabelTemplate = STANDARD_TEMPLATE, label = LABEL) {
  return renderLabelHtml({ label, template, printedAt: PRINTED_AT });
}

function withChanges(changes: (template: LabelTemplate) => void): LabelTemplate {
  const template = structuredClone(STANDARD_TEMPLATE);
  changes(template);
  return template;
}

/** 取出二维码旁网格里每个值单元格的对齐方式。 */
function valueAligns(html: string): string[] {
  return [...html.matchAll(/class="value value-\w+" style="[^"]*text-align:(\w+)"/g)].map((match) => match[1] ?? '');
}

describe('renderLabelHtml', () => {
  test('renders the standard label like the original tag (without the shelf location)', async () => {
    const html = await render();
    expect(html).toContain('>编码：</span><span class="value value-code"');
    expect(html).toContain('>CL5640-TK</span>');
    expect(html).toContain('>图片色</span>');
    expect(html).toContain('>XL</span>');
    expect(html).toContain('>CL5640-TK-图片色-XL</p>');
    expect(html).toContain('<svg');
    expect(html).toContain('size: 60mm 40mm');
    expect(html).toContain('class="layout-qr-left"');
  });

  test('lays side fields out as a prefix/value grid so values always line up', async () => {
    const html = await render(
      withChanges((t) => {
        t.fields.code.prefix = '款号：';
        t.fields.size.prefix = 'Size ';
      }),
    );
    expect(html).toContain('grid-template-columns: max-content minmax(0, 1fr)');
    expect(html).toContain('<span class="prefix prefix-code"');
    expect(html).toContain('<span class="prefix prefix-size"');
    expect(valueAligns(html)).toEqual(['left', 'left', 'left']);
  });

  test('applies one alignment per area: every side value shares it, the bottom row has its own', async () => {
    const html = await render(
      withChanges((t) => {
        t.sideAlign = 'right';
        t.bottomAlign = 'center';
      }),
    );
    expect(valueAligns(html)).toEqual(['right', 'right', 'right']);
    expect(html).toMatch(/class="field field-raw" style="[^"]*text-align:center"/);
  });

  test('keeps side values aligned whether or not a note is shown', async () => {
    const withNote = await render(
      withChanges((t) => {
        t.note = { ...t.note, visible: true, text: '返修' };
      }),
    );
    const withoutNote = await render();
    expect(valueAligns(withNote)).toEqual(valueAligns(withoutNote));
  });

  test('mirrors the layout when the QR code is on the right', async () => {
    const qrRight = BUILT_IN_TEMPLATES.find((t) => t.layout === 'qr-right');
    if (!qrRight) throw new Error('qr-right template missing');
    const html = await render(qrRight);
    expect(html).toContain('size: 60mm 40mm');
    expect(html).toContain('class="layout-qr-right"');
  });

  test('shrinks a 128-character code so it is not clipped', async () => {
    const code = 'C'.repeat(MAX_RAW_LENGTH - '-红-XL'.length);
    const html = await render(STANDARD_TEMPLATE, { raw: `${code}-红-XL`, code, color: '红', size: 'XL' });
    const rawSize = /class="field field-raw" style="font-size:([\d.]+)mm/.exec(html)?.[1];
    expect(Number(rawSize)).toBeLessThan(STANDARD_TEMPLATE.fields.raw.fontSizeMm);
  });

  test('skips an empty note', async () => {
    const html = await render(
      withChanges((t) => {
        t.note = { ...t.note, visible: true, text: '   ' };
      }),
    );
    expect(html).not.toContain('class="note"');
  });

  test('omits the QR code and hidden fields', async () => {
    const html = await render(
      withChanges((t) => {
        t.qr.visible = false;
        t.fields.color.visible = false;
      }),
    );
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('颜色：');
    expect(valueAligns(html)).toHaveLength(2);
  });

  test('applies per-field font size and weight', async () => {
    const html = await render(
      withChanges((t) => {
        t.fields.size = { ...t.fields.size, fontSizeMm: 4.5, bold: false };
      }),
    );
    expect(html).toContain(
      '<span class="value value-size" style="font-size:4.5mm;font-weight:400;text-align:left">XL</span>',
    );
  });

  test('places the note beside the QR code or at the bottom, with variables expanded', async () => {
    const beside = await render(
      withChanges((t) => {
        t.note = { ...t.note, visible: true, text: '备注 {日期}', placement: 'beside-qr' };
      }),
    );
    expect(beside).toMatch(/<div class="side">.*备注 2026-09-28<\/p>\s*<\/div>/s);

    const bottom = await render(
      withChanges((t) => {
        t.note = { ...t.note, visible: true, text: '底部备注', placement: 'bottom' };
      }),
    );
    expect(bottom).toMatch(/<div class="bottom">.*底部备注<\/p><\/div>/s);
  });

  test('escapes markup in label data, prefixes and notes', async () => {
    const html = await render(
      withChanges((t) => {
        t.fields.code.prefix = '<i>';
        t.note = { ...t.note, visible: true, text: '<img src=x>' };
      }),
      { raw: '<b>-"红"-&36', code: '<b>', color: '"红"', size: '&36' },
    );
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<i>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('&lt;img src=x&gt;');
  });
});

describe('print job name', () => {
  // 没有 <title> 时 Chromium 用整段 data: 地址当打印任务名，打印队列里无法辨认，也无法按任务名跟踪。
  test('titles the page with the escaped label code', async () => {
    expect(await render()).toContain('<title>CL5640-TK-图片色-XL</title>');
    const html = await render(STANDARD_TEMPLATE, { raw: '<b>-红-36', code: '<b>', color: '红', size: '36' });
    expect(html).toContain('<title>&lt;b&gt;-红-36</title>');
  });
});

describe('escapeHtml', () => {
  test('escapes all five special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
