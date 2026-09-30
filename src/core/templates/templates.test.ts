import { describe, expect, test } from 'bun:test';
import type { ScanResult } from '../scan/scan-result';
import { InMemoryTemplateRepository } from '../testing/in-memory-repositories';
import { BUILT_IN_TEMPLATES, DEFAULT_TEMPLATE_ID, GENERIC_TEMPLATE, STANDARD_TEMPLATE } from './builtin-templates';
import { expandNoteText } from './note-text';
import { sanitizeTemplate } from './sanitize-template';
import { TemplateCatalog, TemplateError } from './template-catalog';
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

describe('built-in templates', () => {
  test('are all valid and unchanged by sanitizing', () => {
    for (const template of BUILT_IN_TEMPLATES) {
      expect(sanitizeTemplate(template, template.id, STANDARD_TEMPLATE)).toEqual(template);
    }
  });

  test('have unique built-in ids', () => {
    const ids = BUILT_IN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(isBuiltInTemplateId)).toBe(true);
    expect(ids.every((id) => TEMPLATE_ID_PATTERN.test(id))).toBe(true);
  });

  test('default to the generic all-fields template; the garment ones pick 编码 / 颜色 / 尺码 / 货架号', () => {
    expect(DEFAULT_TEMPLATE_ID).toBe(GENERIC_TEMPLATE.id);
    expect(GENERIC_TEMPLATE.fieldsArea.mode).toBe('all');
    expect(STANDARD_TEMPLATE.fieldsArea.mode).toBe('pick');
    expect(STANDARD_TEMPLATE.fieldsArea.slots.map((slot) => slot.field)).toEqual(['编码', '颜色', '尺码', '货架号']);
  });

  // 内置规则都会从手机拍的标签上读货架号：每个挑字段的内置模板都要显示它（没读到时这一行不显示）。
  test('every built-in template that picks fields shows the shelf number', () => {
    for (const template of BUILT_IN_TEMPLATES.filter((item) => item.fieldsArea.mode === 'pick')) {
      expect(template.fieldsArea.slots.map((slot) => slot.field)).toContain('货架号');
    }
  });
});

describe('sanitizeTemplate', () => {
  test('falls back field by field and always uses the given id', () => {
    const result = sanitizeTemplate(
      { id: 'evil', name: '我的模板', layout: 'nope', qr: { sizeMm: 'x' } },
      'custom:1',
      STANDARD_TEMPLATE,
    );
    expect(result.id).toBe('custom:1');
    expect(result.name).toBe('我的模板');
    expect(result.layout).toBe(STANDARD_TEMPLATE.layout);
    expect(result.qr.sizeMm).toBe(STANDARD_TEMPLATE.qr.sizeMm);
  });

  test('clamps padding, QR and font sizes to the allowed ranges', () => {
    const result = sanitizeTemplate(
      {
        paddingMm: 50,
        qr: { sizeMm: 500 },
        fieldsArea: { all: { fontSizeMm: 99 }, slots: [{ field: '编码', fontSizeMm: 0.1 }] },
      },
      'custom:1',
      STANDARD_TEMPLATE,
    );
    expect(result.paddingMm).toBe(TEMPLATE_LIMITS.paddingMm.max);
    expect(result.qr.sizeMm).toBe(maxQrSizeMm(STANDARD_TEMPLATE.paper, TEMPLATE_LIMITS.paddingMm.max));
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
    const result = sanitizeTemplate({ fieldsArea: { mode: 'pick', slots } }, 'custom:1', STANDARD_TEMPLATE);
    expect(result.fieldsArea.slots).toHaveLength(TEMPLATE_LIMITS.slots);
    expect(result.fieldsArea.slots.slice(0, 2).map((slot) => slot.field)).toEqual(['颜色', '字段0']);
  });

  test('accepts both arrangements and keeps the separator on one line', () => {
    const result = sanitizeTemplate(
      { fieldsArea: { arrangement: 'stacked', all: { separator: ':\n' } } },
      'custom:1',
      GENERIC_TEMPLATE,
    );
    expect(result.fieldsArea.arrangement).toBe('stacked');
    expect(result.fieldsArea.all.separator).toBe(':');
    const unknown = sanitizeTemplate({ fieldsArea: { arrangement: 'diagonal' } }, 'custom:1', GENERIC_TEMPLATE);
    expect(unknown.fieldsArea.arrangement).toBe(GENERIC_TEMPLATE.fieldsArea.arrangement);
  });

  test('keeps the existing picked fields when the input is not a list', () => {
    const result = sanitizeTemplate({ fieldsArea: { mode: 'all', slots: 'x' } }, 'custom:1', STANDARD_TEMPLATE);
    expect(result.fieldsArea.mode).toBe('all');
    expect(result.fieldsArea.slots).toEqual(STANDARD_TEMPLATE.fieldsArea.slots);
  });

  test('accepts every QR content source and rejects a malformed one', () => {
    const sanitizeQr = (content: unknown) =>
      sanitizeTemplate({ qr: { content } }, 'custom:1', STANDARD_TEMPLATE).qr.content;
    expect(sanitizeQr({ kind: 'field', field: '订单号' })).toEqual({ kind: 'field', field: '订单号' });
    expect(sanitizeQr({ kind: 'text', text: 'https://example.com/{订单号}' })).toEqual({
      kind: 'text',
      text: 'https://example.com/{订单号}',
    });
    expect(sanitizeQr({ kind: 'field', field: '' })).toEqual({ kind: 'raw' });
    expect(sanitizeQr({ kind: 'script' })).toEqual({ kind: 'raw' });
  });

  test('strips control characters but keeps line breaks in notes', () => {
    const result = sanitizeTemplate({ note: { text: '第一行\n第二\u0007行' } }, 'custom:1', STANDARD_TEMPLATE);
    expect(result.note.text).toBe('第一行\n第二行');
  });

  test('truncates long text', () => {
    const result = sanitizeTemplate({ note: { text: 'x'.repeat(1_000) } }, 'custom:1', STANDARD_TEMPLATE);
    expect(result.note.text).toHaveLength(TEMPLATE_LIMITS.noteLength);
  });

  test('keeps the fallback name when the new one is blank', () => {
    expect(sanitizeTemplate({ name: '' }, 'custom:1', STANDARD_TEMPLATE).name).toBe(STANDARD_TEMPLATE.name);
    expect(sanitizeTemplate({ name: '   ' }, 'custom:1', STANDARD_TEMPLATE).name).toBe(STANDARD_TEMPLATE.name);
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
    const copy = catalog.duplicate(STANDARD_TEMPLATE.id);
    expect(catalog.list().map((t) => t.id)).toEqual([...BUILT_IN_TEMPLATES.map((t) => t.id), copy.id]);
  });

  test('duplicate creates an editable custom copy', () => {
    const { catalog, repository } = createCatalog();
    const copy = catalog.duplicate(STANDARD_TEMPLATE.id);
    expect(copy.id).toBe(`${CUSTOM_TEMPLATE_PREFIX}t1`);
    expect(copy.name).toBe(`${STANDARD_TEMPLATE.name} 副本`);
    expect(repository.saved.get(copy.id)).toEqual(copy);
    const [firstSlot] = copy.fieldsArea.slots;
    if (!firstSlot) throw new Error('expected picked fields');
    firstSlot.prefix = 'changed';
    expect(STANDARD_TEMPLATE.fieldsArea.slots[0]?.prefix).toBe('编码：');
  });

  test('save sanitizes and persists a custom template', () => {
    const { catalog } = createCatalog();
    const copy = catalog.duplicate(STANDARD_TEMPLATE.id);
    const saved = catalog.save(copy.id, { ...copy, note: { ...copy.note, visible: true, text: '样衣间' } });
    expect(saved.note).toMatchObject({ visible: true, text: '样衣间' });
    expect(catalog.get(copy.id)).toEqual(saved);
  });

  test('built-in templates are read-only', () => {
    const { catalog } = createCatalog();
    expect(() => catalog.save(STANDARD_TEMPLATE.id, STANDARD_TEMPLATE)).toThrow(TemplateError);
    expect(() => catalog.remove(STANDARD_TEMPLATE.id)).toThrow(TemplateError);
  });

  test('saving or removing an unknown template fails', () => {
    const { catalog } = createCatalog();
    expect(() => catalog.save('custom:missing', {})).toThrow(TemplateError);
    expect(() => catalog.remove('custom:missing')).toThrow(TemplateError);
  });

  test('resolve falls back to the generic template', () => {
    const { catalog } = createCatalog();
    expect(catalog.resolve('custom:deleted')).toBe(GENERIC_TEMPLATE);
  });
});

describe('template paper and printer', () => {
  const fallback = STANDARD_TEMPLATE;

  test('an old template without paper is 60x40 with no printer of its own', () => {
    const { paper: _paper, printer: _printer, ...old } = fallback;
    const template = sanitizeTemplate(old, 'custom:old', fallback);
    expect(template.paper).toEqual({ widthMm: 60, heightMm: 40 });
    expect(template.printer).toBeNull();
  });

  test('keeps a waybill paper and a named printer', () => {
    const template = sanitizeTemplate(
      { ...fallback, paper: { widthMm: 100, heightMm: 180 }, printer: '面单机B' },
      'custom:waybill',
      fallback,
    );
    expect(template.paper).toEqual({ widthMm: 100, heightMm: 180 });
    expect(template.printer).toBe('面单机B');
  });

  test('treats a blank or oversized printer name as no printer', () => {
    expect(sanitizeTemplate({ ...fallback, printer: '  ' }, 'custom:a', fallback).printer).toBeNull();
    expect(sanitizeTemplate({ ...fallback, printer: 'x'.repeat(257) }, 'custom:a', fallback).printer).toBeNull();
  });

  test('limits the QR code to the short side of the paper', () => {
    const small = sanitizeTemplate(
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
});
