import { describe, expect, test } from 'bun:test';
import type { ScanResult } from '../scan/scan-result';
import { InMemoryTemplateRepository } from '../testing/in-memory-repositories';
import { labelOf, PICK_TEMPLATE } from '../testing/templates';
import { CANVAS_TAG } from './builtin-canvas';
import { BUILT_IN_TEMPLATES, currentTemplateId, DEFAULT_TEMPLATE_ID, GENERIC_TEMPLATE } from './builtin-templates';
import { expandNoteText } from './note-text';
import { sanitizeTemplate } from './sanitize-template';
import { NEW_CANVAS_TEMPLATE_NAME, TemplateCatalog, TemplateError } from './template-catalog';
import {
  CUSTOM_TEMPLATE_PREFIX,
  fullTextWidthMm,
  isBuiltInTemplateId,
  maxQrSizeMm,
  TEMPLATE_ID_PATTERN,
  TEMPLATE_LIMITS,
  withPaper,
} from './template-model';

const SCAN: ScanResult = {
  raw: 'CL5640-TK-图片色-XXL',
  ruleId: 'builtin:dash-three',
  ruleName: '横杠三段（编码-颜色-尺码）',
  fields: [
    { name: '编码', value: 'CL5640-TK' },
    { name: '颜色', value: '图片色' },
    { name: '尺码', value: 'XXL' },
  ],
};

function createCatalog() {
  const repository = new InMemoryTemplateRepository();
  let nextId = 0;
  const catalog = new TemplateCatalog(repository, () => `t${++nextId}`);
  return { repository, catalog };
}

/** 这些用例都是标签模板：结果收窄成标签模板再断言。 */
function sanitizeLabel(...args: Parameters<typeof sanitizeTemplate>) {
  return labelOf(sanitizeTemplate(...args));
}

describe('built-in templates', () => {
  test('are all valid and unchanged by sanitizing', () => {
    for (const template of BUILT_IN_TEMPLATES) {
      expect(sanitizeTemplate(template, template.id, template)).toEqual(template);
    }
  });

  test('have unique built-in ids', () => {
    const ids = BUILT_IN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(isBuiltInTemplateId)).toBe(true);
    expect(ids.every((id) => TEMPLATE_ID_PATTERN.test(id))).toBe(true);
  });

  test('default to the generic template', () => {
    expect(DEFAULT_TEMPLATE_ID).toBe(GENERIC_TEMPLATE.id);
  });

  // 「样衣」几套和「通用」打出来几乎一样，1.3.0 并成一组：都叫「通用」，都列出全部字段。
  // 内置规则都会从手机拍的标签上读货架号，全部字段里就有它（没读到时这一行不显示）。
  test('every built-in label template is a generic one that lists every field', () => {
    const labels = BUILT_IN_TEMPLATES.flatMap((item) => (item.kind === 'label' ? [item] : []));
    expect(labels.map((template) => template.name)).toEqual([
      '通用（二维码在左）',
      '通用（二维码在右）',
      '通用（字段名在上）',
      '通用 · 大字（无二维码）',
      '通用 · 大二维码 + 日期备注',
      '通用 · 小二维码 + 底部备注',
    ]);
    expect(labels.every((template) => template.fieldsArea.mode === 'all')).toBe(true);
  });

  // 复制一个内置模板、切到「指定字段」，就是原来样衣模板的字段行，不用一行一行加。
  test('come with the garment fields ready for the pick mode', () => {
    expect(GENERIC_TEMPLATE.fieldsArea.slots.map((slot) => `${slot.prefix}${slot.field}`)).toEqual([
      '编码：编码',
      '颜色：颜色',
      '尺码：尺码',
      '货架号：货架号',
    ]);
  });
});

describe('currentTemplateId', () => {
  test('moves a retired garment template to the generic one with the same layout', () => {
    expect(currentTemplateId('builtin:standard')).toBe('builtin:generic');
    expect(currentTemplateId('builtin:qr-right')).toBe('builtin:generic-qr-right');
    expect(currentTemplateId('builtin:plain')).toBe('builtin:generic');
  });

  test('keeps every other id', () => {
    expect(currentTemplateId('builtin:big-qr')).toBe('builtin:big-qr');
    expect(currentTemplateId('custom:standard')).toBe('custom:standard');
  });

  test('only ever points at a template that exists', () => {
    const ids = new Set(BUILT_IN_TEMPLATES.map((template) => template.id));
    for (const retired of ['builtin:standard', 'builtin:qr-right', 'builtin:plain']) {
      expect(ids.has(retired)).toBe(false);
      expect(ids.has(currentTemplateId(retired))).toBe(true);
    }
  });
});

describe('sanitizeTemplate', () => {
  test('falls back field by field and always uses the given id', () => {
    const result = sanitizeLabel(
      { id: 'evil', name: '我的模板', layout: 'nope', qr: { sizeMm: 'x' } },
      'custom:1',
      PICK_TEMPLATE,
    );
    expect(result.id).toBe('custom:1');
    expect(result.name).toBe('我的模板');
    expect(result.layout).toBe(PICK_TEMPLATE.layout);
    expect(result.qr.sizeMm).toBe(PICK_TEMPLATE.qr.sizeMm);
  });

  test('clamps padding, QR and font sizes to the allowed ranges', () => {
    const result = sanitizeLabel(
      {
        paddingMm: 50,
        qr: { sizeMm: 500 },
        fieldsArea: { all: { fontSizeMm: 99 }, slots: [{ field: '编码', fontSizeMm: 0.1 }] },
      },
      'custom:1',
      PICK_TEMPLATE,
    );
    expect(result.paddingMm).toBe(TEMPLATE_LIMITS.paddingMm.max);
    expect(result.qr.sizeMm).toBe(maxQrSizeMm(PICK_TEMPLATE.paper, TEMPLATE_LIMITS.paddingMm.max));
    expect(result.fieldsArea.all.fontSizeMm).toBe(TEMPLATE_LIMITS.fontSizeMm.max);
    expect(result.fieldsArea.slots[0]).toEqual({
      field: '编码',
      prefix: '',
      fontSizeMm: TEMPLATE_LIMITS.fontSizeMm.min,
      bold: true,
    });
  });

  test('drops picked fields with invalid or repeated names and keeps at most eight', () => {
    const slots = [
      { field: '颜色' },
      { field: '' },
      { field: '{注入}' },
      { field: '颜色' },
      ...Array.from({ length: 10 }, (_, index) => ({ field: `字段${index}` })),
    ];
    const result = sanitizeLabel({ fieldsArea: { mode: 'pick', slots } }, 'custom:1', PICK_TEMPLATE);
    expect(result.fieldsArea.slots).toHaveLength(TEMPLATE_LIMITS.slots);
    expect(result.fieldsArea.slots.slice(0, 2).map((slot) => slot.field)).toEqual(['颜色', '字段0']);
  });

  test('accepts both arrangements and keeps the separator on one line', () => {
    const result = sanitizeLabel(
      { fieldsArea: { arrangement: 'stacked', all: { separator: ':\n' } } },
      'custom:1',
      GENERIC_TEMPLATE,
    );
    expect(result.fieldsArea.arrangement).toBe('stacked');
    expect(result.fieldsArea.all.separator).toBe(':');
    const unknown = sanitizeLabel({ fieldsArea: { arrangement: 'diagonal' } }, 'custom:1', GENERIC_TEMPLATE);
    expect(unknown.fieldsArea.arrangement).toBe(GENERIC_TEMPLATE.fieldsArea.arrangement);
  });

  test('keeps the existing picked fields when the input is not a list', () => {
    const result = sanitizeLabel({ fieldsArea: { mode: 'all', slots: 'x' } }, 'custom:1', PICK_TEMPLATE);
    expect(result.fieldsArea.mode).toBe('all');
    expect(result.fieldsArea.slots).toEqual(PICK_TEMPLATE.fieldsArea.slots);
  });

  test('accepts every QR content source and rejects a malformed one', () => {
    const sanitizeQr = (content: unknown) => sanitizeLabel({ qr: { content } }, 'custom:1', PICK_TEMPLATE).qr.content;
    expect(sanitizeQr({ kind: 'field', field: '订单号' })).toEqual({ kind: 'field', field: '订单号' });
    expect(sanitizeQr({ kind: 'text', text: 'https://example.com/{订单号}' })).toEqual({
      kind: 'text',
      text: 'https://example.com/{订单号}',
    });
    expect(sanitizeQr({ kind: 'field', field: '' })).toEqual({ kind: 'raw' });
    expect(sanitizeQr({ kind: 'script' })).toEqual({ kind: 'raw' });
  });

  test('strips control characters but keeps line breaks in notes', () => {
    const result = sanitizeLabel({ note: { text: '第一行\n第二\u0007行' } }, 'custom:1', PICK_TEMPLATE);
    expect(result.note.text).toBe('第一行\n第二行');
  });

  test('truncates long text', () => {
    const result = sanitizeLabel({ note: { text: 'x'.repeat(1_000) } }, 'custom:1', PICK_TEMPLATE);
    expect(result.note.text).toHaveLength(TEMPLATE_LIMITS.noteLength);
  });

  test('keeps the fallback name when the new one is blank', () => {
    expect(sanitizeLabel({ name: '' }, 'custom:1', PICK_TEMPLATE).name).toBe(PICK_TEMPLATE.name);
    expect(sanitizeLabel({ name: '   ' }, 'custom:1', PICK_TEMPLATE).name).toBe(PICK_TEMPLATE.name);
  });
});

describe('expandNoteText', () => {
  test('replaces field names, the full content, the rule name and local date and time', () => {
    const printedAt = new Date(2026, 8, 28, 9, 5);
    expect(expandNoteText('{编码}/{颜色}/{尺码}/{完整内容} {日期} {时间} {规则}', SCAN, printedAt)).toBe(
      'CL5640-TK/图片色/XXL/CL5640-TK-图片色-XXL 2026-09-28 09:05 横杠三段（编码-颜色-尺码）',
    );
  });

  // 标签上不能出现「{货架号}」这样的原文：这次没有这个字段（扫码枪扫的没有图、没认出、规则里没有）就印成空。
  test('prints nothing for a field this scan did not produce', () => {
    expect(expandNoteText('货架号：{货架号} 质检 {工号}', SCAN, new Date())).toBe('货架号： 质检 ');
  });

  test('keeps braces that are not a variable', () => {
    expect(expandNoteText('{} 尺码{', SCAN, new Date())).toBe('{} 尺码{');
  });

  test('prefers the fixed variables over a recognised field with the same name', () => {
    const scan: ScanResult = { ...SCAN, fields: [{ name: '日期', value: '昨天' }] };
    expect(expandNoteText('{日期}', scan, new Date(2026, 8, 28))).toBe('2026-09-28');
  });
});

describe('TemplateCatalog', () => {
  test('lists built-ins before custom templates', () => {
    const { catalog } = createCatalog();
    const copy = catalog.duplicate(GENERIC_TEMPLATE.id);
    expect(catalog.list().map((t) => t.id)).toEqual([...BUILT_IN_TEMPLATES.map((t) => t.id), copy.id]);
  });

  test('duplicate creates an editable custom copy', () => {
    const { catalog, repository } = createCatalog();
    const copy = labelOf(catalog.duplicate(GENERIC_TEMPLATE.id));
    expect(copy.id).toBe(`${CUSTOM_TEMPLATE_PREFIX}t1`);
    expect(copy.name).toBe(`${GENERIC_TEMPLATE.name} 副本`);
    expect(repository.saved.get(copy.id)).toEqual(copy);
    copy.fieldsArea.all.separator = 'changed';
    expect(GENERIC_TEMPLATE.fieldsArea.all.separator).toBe('：');
  });

  test('createCanvas saves an empty canvas template on the default paper', () => {
    const { catalog, repository } = createCatalog();
    const created = catalog.createCanvas();
    expect(created).toEqual({
      kind: 'canvas',
      id: `${CUSTOM_TEMPLATE_PREFIX}t1`,
      name: NEW_CANVAS_TEMPLATE_NAME,
      paper: { widthMm: 60, heightMm: 40 },
      printer: null,
      elements: [],
    });
    expect(repository.saved.get(created.id)).toEqual(created);
  });

  test('save sanitizes and persists a custom template', () => {
    const { catalog } = createCatalog();
    const copy = labelOf(catalog.duplicate(GENERIC_TEMPLATE.id));
    const saved = labelOf(catalog.save(copy.id, { ...copy, note: { ...copy.note, visible: true, text: '样衣间' } }));
    expect(saved.note).toMatchObject({ visible: true, text: '样衣间' });
    expect(catalog.get(copy.id)).toEqual(saved);
  });

  test('built-in templates are read-only', () => {
    const { catalog } = createCatalog();
    expect(() => catalog.save(GENERIC_TEMPLATE.id, GENERIC_TEMPLATE)).toThrow(TemplateError);
    expect(() => catalog.remove(GENERIC_TEMPLATE.id)).toThrow(TemplateError);
  });

  test('saving or removing an unknown template fails', () => {
    const { catalog } = createCatalog();
    expect(() => catalog.save('custom:missing', {})).toThrow(TemplateError);
    expect(() => catalog.remove('custom:missing')).toThrow(TemplateError);
  });

  // 打印记录里存的是当时的编号：升级前用样衣模板打的记录，重打时用替代它的通用模板，不能说「模板已删除」。
  test('finds a retired garment template under its generic replacement', () => {
    const { catalog } = createCatalog();
    expect(catalog.get('builtin:standard')?.id).toBe('builtin:generic');
    expect(catalog.get('builtin:qr-right')?.id).toBe('builtin:generic-qr-right');
  });

  test('resolve falls back to the generic template', () => {
    const { catalog } = createCatalog();
    expect(catalog.resolve('custom:deleted')).toBe(GENERIC_TEMPLATE);
  });
});

describe('template paper and printer', () => {
  const fallback = PICK_TEMPLATE;

  test('an old template without paper is 60x40 with no printer of its own', () => {
    const { paper: _paper, printer: _printer, ...old } = fallback;
    const template = sanitizeLabel(old, 'custom:old', fallback);
    expect(template.paper).toEqual({ widthMm: 60, heightMm: 40 });
    expect(template.printer).toBeNull();
  });

  test('keeps a waybill paper and a named printer', () => {
    const template = sanitizeLabel(
      { ...fallback, paper: { widthMm: 100, heightMm: 180 }, printer: '面单机B' },
      'custom:waybill',
      fallback,
    );
    expect(template.paper).toEqual({ widthMm: 100, heightMm: 180 });
    expect(template.printer).toBe('面单机B');
  });

  test('treats a blank or oversized printer name as no printer', () => {
    expect(sanitizeLabel({ ...fallback, printer: '  ' }, 'custom:a', fallback).printer).toBeNull();
    expect(sanitizeLabel({ ...fallback, printer: 'x'.repeat(257) }, 'custom:a', fallback).printer).toBeNull();
  });

  test('limits the QR code to the short side of the paper', () => {
    const small = sanitizeLabel(
      { ...fallback, paper: { widthMm: 40, heightMm: 30 }, qr: { ...fallback.qr, sizeMm: 36 } },
      'custom:small',
      fallback,
    );
    expect(small.qr.sizeMm).toBe(maxQrSizeMm(small.paper, small.paddingMm));
  });

  test('measures the text areas on the template paper', () => {
    const wide = { ...fallback, paper: { widthMm: 100, heightMm: 100 } };
    expect(fullTextWidthMm(wide)).toBe(100 - 2 * wide.paddingMm);
  });

  test('moves a template to another paper and shrinks the QR code to fit', () => {
    const moved = withPaper({ ...fallback, qr: { ...fallback.qr, sizeMm: 36 } }, { widthMm: 40, heightMm: 30 });
    expect(moved.paper).toEqual({ widthMm: 40, heightMm: 30 });
    expect(moved.qr.sizeMm).toBe(maxQrSizeMm(moved.paper, moved.paddingMm));
  });

  // 60×40 的 22mm 二维码放到 50×30 上：按短边等比缩小，底部整行才放得下（不缩的话会被挤出标签裁掉）。
  test('scales the QR code down with the short side of a smaller paper', () => {
    const moved = withPaper({ ...fallback, qr: { ...fallback.qr, sizeMm: 22 } }, { widthMm: 50, heightMm: 30 });
    expect(moved.qr.sizeMm).toBe(16.5);
  });

  test('keeps the QR size on a larger paper and never goes below the minimum', () => {
    const larger = withPaper({ ...fallback, qr: { ...fallback.qr, sizeMm: 22 } }, { widthMm: 100, heightMm: 180 });
    expect(larger.qr.sizeMm).toBe(22);
    const tiny = withPaper({ ...fallback, qr: { ...fallback.qr, sizeMm: 12 } }, { widthMm: 30, heightMm: 25 });
    expect(tiny.qr.sizeMm).toBe(TEMPLATE_LIMITS.qrSizeMm.min);
  });

  // 自由设计模板的 60×40 示例里有个 x=2 width=56 的条码（右边到 58），换到更小的纸上不收进去的话会被裁掉一截。
  test('pulls canvas elements back inside a smaller paper', () => {
    const moved = withPaper(CANVAS_TAG, { widthMm: 40, heightMm: 30 });
    expect(moved.paper).toEqual({ widthMm: 40, heightMm: 30 });
    for (const element of moved.elements) {
      expect(element.x).toBeGreaterThanOrEqual(0);
      expect(element.y).toBeGreaterThanOrEqual(0);
      expect(element.x + element.width).toBeLessThanOrEqual(40);
      expect(element.y + element.height).toBeLessThanOrEqual(30);
    }
  });
});
