import { describe, expect, test } from 'bun:test';
import type { ScanResult } from '../../core/scan/scan-result';
import { BUILT_IN_TEMPLATES, GENERIC_TEMPLATE } from '../../core/templates/builtin-templates';
import { type FieldSlot, maxQrSizeMm, type QrLabelTemplate } from '../../core/templates/template-model';
import { PICK_TEMPLATE } from '../../core/testing/templates';
import type { LabelJob } from '../../core/types';
import type { PaperSize } from '../../shared/paper-sizes';
import { escapeHtml, renderLabelHtml } from './label-html';

const GARMENT: ScanResult = {
  raw: 'CL5640-TK-图片色-XL',
  ruleId: 'builtin:dash-three',
  ruleName: '横杠三段（编码-颜色-尺码）',
  fields: [
    { name: '编码', value: 'CL5640-TK' },
    { name: '颜色', value: '图片色' },
    { name: '尺码', value: 'XL' },
  ],
};
const KEY_VALUE: ScanResult = {
  raw: '订单号：A001\n收件人：张三',
  ruleId: 'builtin:key-value',
  ruleName: '多行键值',
  fields: [
    { name: '订单号', value: 'A001' },
    { name: '收件人', value: '张三' },
  ],
};
const PRINTED_AT = new Date(2026, 8, 28, 9, 5).getTime();

/** 内置的标签模板（不含面单）。 */
const LABEL_TEMPLATES = BUILT_IN_TEMPLATES.flatMap((template) => (template.kind === 'label' ? [template] : []));

function render(template: QrLabelTemplate = PICK_TEMPLATE, scan = GARMENT): string {
  return renderLabelHtml({ scan, template, printedAt: PRINTED_AT }).html;
}

function withChanges(changes: (template: QrLabelTemplate) => void, base = PICK_TEMPLATE): QrLabelTemplate {
  const template = structuredClone(base);
  changes(template);
  return template;
}

function slot(template: QrLabelTemplate, field: string): FieldSlot {
  const found = template.fieldsArea.slots.find((candidate) => candidate.field === field);
  if (!found) throw new Error(`slot ${field} missing`);
  return found;
}

/** 取出字段区每个值单元格的对齐方式。 */
function valueAligns(html: string): string[] {
  return [...html.matchAll(/class="value" style="[^"]*text-align:(\w+)"/g)].map((match) => match[1] ?? '');
}

function valueSizes(html: string): number[] {
  return [...html.matchAll(/class="value" style="font-size:([\d.]+)mm/g)].map((match) => Number(match[1]));
}

describe('renderLabelHtml', () => {
  test('renders the garment label like the original tag (without the shelf location)', () => {
    const html = render();
    expect(html).toContain('>编码：</span><span class="value"');
    expect(html).toContain('>CL5640-TK</span>');
    expect(html).toContain('>图片色</span>');
    expect(html).toContain('>XL</span>');
    expect(html).toContain('>CL5640-TK-图片色-XL</p>');
    expect(html).toContain('<svg');
    expect(html).toContain('size: 60mm 40mm');
    expect(html).toContain('class="layout-qr-left"');
  });

  // 内置规则从手机拍的标签上读出货架号：每个内置标签模板都要把它印出来，没读到时不留空行。
  test('every built-in label template prints the shelf number only when one was read', () => {
    const withShelf: ScanResult = { ...GARMENT, fields: [...GARMENT.fields, { name: '货架号', value: 'A-1-2-3' }] };
    const unread: ScanResult = { ...GARMENT, fields: [...GARMENT.fields, { name: '货架号', value: '' }] };
    for (const template of LABEL_TEMPLATES) {
      expect(render(template, withShelf)).toContain('>A-1-2-3</span>');
      expect(render(template, unread)).toBe(render(template, GARMENT));
    }
  });

  // 内置规则都会读货架号：每个内置模板（标签、面单、自由设计）都给它留了位置，读到就印，没读到时那一行不印。
  test('every built-in template has a place for the shelf number and hides it when none was read', () => {
    const withShelf: ScanResult = { ...GARMENT, fields: [...GARMENT.fields, { name: '货架号', value: 'A-1-2-3' }] };
    const unread: ScanResult = { ...GARMENT, fields: [...GARMENT.fields, { name: '货架号', value: '' }] };
    for (const template of BUILT_IN_TEMPLATES) {
      const html = (scan: ScanResult) => renderLabelHtml({ scan, template, printedAt: PRINTED_AT }).html;
      expect({ template: template.name, printed: html(withShelf).includes('A-1-2-3') }).toEqual({
        template: template.name,
        printed: true,
      });
      expect(html(unread)).toBe(html(GARMENT));
      expect(html(GARMENT)).not.toContain('货架号');
    }
  });

  test('the generic template lists every recognised field with its name', () => {
    const html = render(GENERIC_TEMPLATE, KEY_VALUE);
    expect(html).toContain('>订单号：</span><span class="value"');
    expect(html).toContain('>收件人：</span>');
    expect(html).toContain('>订单号：A001 / 收件人：张三</p>');
  });

  test('uses the separator set in the template, or none', () => {
    const dash = withChanges((t) => {
      t.fieldsArea.all.separator = ' - ';
    }, GENERIC_TEMPLATE);
    expect(render(dash, KEY_VALUE)).toContain('>订单号 - </span>');
    const none = withChanges((t) => {
      t.fieldsArea.all.separator = '';
    }, GENERIC_TEMPLATE);
    expect(render(none, KEY_VALUE)).toContain('>订单号</span>');
  });

  test('stacks the name above the value when arranged vertically', () => {
    const stacked = LABEL_TEMPLATES.find((t) => t.fieldsArea.arrangement === 'stacked');
    if (!stacked) throw new Error('stacked template missing');
    const html = render(stacked, KEY_VALUE);
    expect(html).toContain('class="fields fields--stacked"');
    expect(html).toMatch(/<div class="field"><span class="prefix" style="[^"]*font-weight:400[^"]*">订单号<\/span>/);
    expect(html).toContain('>A001</span></div>');
  });

  test('gives every row the same size in the all-fields mode', () => {
    const scan: ScanResult = {
      ...KEY_VALUE,
      fields: [
        { name: '订单号', value: 'A20260928-000000001' },
        { name: '款号', value: 'CL5640' },
      ],
    };
    const sizes = valueSizes(render(GENERIC_TEMPLATE, scan));
    expect(sizes).toHaveLength(2);
    expect(sizes[0]).toBe(sizes[1]);
  });

  test('does not print a numeric order number twice', () => {
    const order: ScanResult = {
      raw: '202609280001',
      ruleId: 'builtin:digits-order',
      ruleName: '纯数字订单号',
      fields: [{ name: '订单号', value: '202609280001' }],
    };
    const html = render(GENERIC_TEMPLATE, order);
    expect(html).toContain('>202609280001</span>');
    expect(html).not.toContain('class="bottom-line"');
  });

  test('keeps line breaks inside multi-line values', () => {
    const scan: ScanResult = { ...GARMENT, raw: '一号楼\n三单元', fields: [{ name: '地址', value: '一号楼\n三单元' }] };
    const html = render(GENERIC_TEMPLATE, scan);
    expect(html).toContain('.value, .note { white-space: pre-line; }');
    expect(html).toContain('>一号楼\n三单元</span>');
  });

  test('lays fields out as a prefix/value grid so values always line up', () => {
    const html = render(
      withChanges((t) => {
        slot(t, '编码').prefix = '款号：';
        slot(t, '尺码').prefix = 'Size ';
      }),
    );
    expect(html).toContain('grid-template-columns: max-content minmax(0, 1fr)');
    expect(html).toContain('>款号：</span>');
    expect(html).toContain('>Size </span>');
    expect(valueAligns(html)).toEqual(['left', 'left', 'left']);
  });

  test('applies one alignment per area: every side value shares it, the bottom row has its own', () => {
    const html = render(
      withChanges((t) => {
        t.sideAlign = 'right';
        t.bottomAlign = 'center';
      }),
    );
    expect(valueAligns(html)).toEqual(['right', 'right', 'right']);
    expect(html).toMatch(/class="bottom-line" style="[^"]*text-align:center"/);
  });

  test('keeps side values aligned whether or not a note is shown', () => {
    const withNote = render(
      withChanges((t) => {
        t.note = { ...t.note, visible: true, text: '返修' };
      }),
    );
    expect(valueAligns(withNote)).toEqual(valueAligns(render()));
  });

  test('mirrors the layout when the QR code is on the right', () => {
    const qrRight = LABEL_TEMPLATES.find((t) => t.layout === 'qr-right');
    if (!qrRight) throw new Error('qr-right template missing');
    expect(render(qrRight)).toContain('class="layout-qr-right"');
  });

  test('shrinks a long code so it is not clipped', () => {
    const code = 'C'.repeat(120);
    const scan: ScanResult = {
      ...GARMENT,
      raw: `${code}-红-XL`,
      fields: [
        { name: '编码', value: code },
        { name: '颜色', value: '红' },
        { name: '尺码', value: 'XL' },
      ],
    };
    const bottomSize = /class="bottom-line" style="font-size:([\d.]+)mm/.exec(render(PICK_TEMPLATE, scan))?.[1];
    expect(Number(bottomSize)).toBeLessThan(PICK_TEMPLATE.bottom.fontSizeMm);
  });

  test('shrinks the field rows when they do not fit the height of the label', () => {
    const fields = Array.from({ length: 6 }, (_, index) => ({
      name: `字段${index + 1}`,
      value: '内容比较长的一行文字',
    }));
    const sizes = valueSizes(render(GENERIC_TEMPLATE, { ...GARMENT, fields }));
    expect(sizes).toHaveLength(6);
    expect(Math.max(...sizes)).toBeLessThan(GENERIC_TEMPLATE.fieldsArea.all.fontSizeMm);
  });

  test('skips an empty note', () => {
    const html = render(
      withChanges((t) => {
        t.note = { ...t.note, visible: true, text: '   ' };
      }),
    );
    expect(html).not.toContain('class="note"');
  });

  test('omits the QR code and the bottom line when hidden', () => {
    const html = render(
      withChanges((t) => {
        t.qr.visible = false;
        t.bottom.visible = false;
      }),
    );
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('class="bottom-line"');
  });

  test('applies per-field font size and weight', () => {
    const html = render(
      withChanges((t) => {
        Object.assign(slot(t, '尺码'), { fontSizeMm: 4.5, bold: false });
      }),
    );
    expect(html).toContain('<span class="value" style="font-size:4.5mm;font-weight:400;text-align:left">XL</span>');
  });

  test('places the note beside the QR code or at the bottom, with variables expanded', () => {
    const beside = render(
      withChanges((t) => {
        t.note = { ...t.note, visible: true, text: '备注 {日期} {颜色}', placement: 'beside-qr' };
      }),
    );
    expect(beside).toMatch(/<div class="side">.*备注 2026-09-28 图片色<\/p>\s*<\/div>/s);

    const bottom = render(
      withChanges((t) => {
        t.note = { ...t.note, visible: true, text: '底部备注', placement: 'bottom' };
      }),
    );
    expect(bottom).toMatch(/<div class="bottom">.*底部备注<\/p><\/div>/s);
  });

  test('escapes markup in scanned content, prefixes and notes', () => {
    const scan: ScanResult = {
      ...GARMENT,
      raw: '<b>-"红"-&36',
      fields: [
        { name: '编码', value: '<b>' },
        { name: '颜色', value: '"红"' },
        { name: '尺码', value: '&36' },
      ],
    };
    const html = render(
      withChanges((t) => {
        slot(t, '编码').prefix = '<i>';
        t.note = { ...t.note, visible: true, text: '<img src=x>' };
      }),
      scan,
    );
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<i>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('&lt;img src=x&gt;');
  });
});

describe('QR code', () => {
  test('encodes what the template asks for', () => {
    const plain = renderLabelHtml({ scan: GARMENT, template: PICK_TEMPLATE, printedAt: PRINTED_AT });
    const byField = renderLabelHtml({
      scan: GARMENT,
      template: withChanges((t) => {
        t.qr.content = { kind: 'field', field: '编码' };
      }),
      printedAt: PRINTED_AT,
    });
    expect(byField.html).not.toBe(plain.html);
    expect(byField.qrOmitted).toBe(false);
  });

  test('centres the dot-aligned code inside the box the template reserves', () => {
    const html = render();
    expect(html).toContain(`width: ${PICK_TEMPLATE.qr.sizeMm}mm; height: ${PICK_TEMPLATE.qr.sizeMm}mm;`);
    const size = Number(/class="qr__code" style="width:([\d.]+)mm/.exec(html)?.[1]);
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThanOrEqual(PICK_TEMPLATE.qr.sizeMm);
  });

  test('leaves the QR code out when even the lowest error correction cannot make it scannable', () => {
    const long = '码'.repeat(600);
    const scan: ScanResult = { ...GARMENT, raw: long, fields: [{ name: '内容', value: long }] };
    const omitted = renderLabelHtml({ scan, template: PICK_TEMPLATE, printedAt: PRINTED_AT });
    expect(omitted.qrOmitted).toBe(true);
    expect(omitted.html).not.toContain('<svg');
  });
});

describe('print job name', () => {
  // 没有 <title> 时 Chromium 用整段 data: 地址当打印任务名，打印队列里无法辨认，也无法按任务名跟踪。
  test('titles the page with the escaped content on one line', () => {
    expect(render()).toContain('<title>CL5640-TK-图片色-XL</title>');
    const scan: ScanResult = { ...GARMENT, raw: '<b>\n第二行' };
    expect(render(PICK_TEMPLATE, scan)).toContain('<title>&lt;b&gt; / 第二行</title>');
  });
});

describe('escapeHtml', () => {
  test('escapes all five special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});

describe('paper sizes', () => {
  const job = (paper: PaperSize): LabelJob => ({
    scan: GARMENT,
    template: {
      ...PICK_TEMPLATE,
      paper,
      qr: {
        ...PICK_TEMPLATE.qr,
        sizeMm: Math.min(PICK_TEMPLATE.qr.sizeMm, maxQrSizeMm(paper, PICK_TEMPLATE.paddingMm)),
      },
    },
    printedAt: PRINTED_AT,
  });

  test.each([
    { widthMm: 50, heightMm: 30 },
    { widthMm: 70, heightMm: 50 },
    { widthMm: 100, heightMm: 100 },
  ])('lays out a $widthMm x $heightMm label on that paper', (paper) => {
    const { html, qrOmitted } = renderLabelHtml(job(paper));
    expect(html).toContain(`@page { size: ${paper.widthMm}mm ${paper.heightMm}mm; margin: 0; }`);
    expect(qrOmitted).toBe(false);
  });

  test('aligns the QR code to the resolution it is given', () => {
    const label = job({ widthMm: 60, heightMm: 40 });
    expect(renderLabelHtml(label, 300).html).not.toBe(renderLabelHtml(label, 203).html);
  });
});
