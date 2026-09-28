import { describe, expect, test } from 'bun:test';
import type { ScanResult } from '../scan/scan-result';
import { InMemoryTemplateRepository } from '../testing/in-memory-repositories';
import { BUILT_IN_TEMPLATES, DEFAULT_TEMPLATE_ID, GENERIC_TEMPLATE, STANDARD_TEMPLATE } from './builtin-templates';
import { expandNoteText } from './note-text';
import { sanitizeTemplate } from './sanitize-template';
import { TemplateCatalog, TemplateError } from './template-catalog';
import {
  CUSTOM_TEMPLATE_PREFIX,
  isBuiltInTemplateId,
  maxQrSizeMm,
  TEMPLATE_ID_PATTERN,
  TEMPLATE_LIMITS,
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

  test('default to the generic all-fields template; the garment ones pick 编码 / 颜色 / 尺码', () => {
    expect(DEFAULT_TEMPLATE_ID).toBe(GENERIC_TEMPLATE.id);
    expect(GENERIC_TEMPLATE.fieldsArea.mode).toBe('all');
    expect(STANDARD_TEMPLATE.fieldsArea.mode).toBe('pick');
    expect(STANDARD_TEMPLATE.fieldsArea.slots.map((slot) => slot.field)).toEqual(['编码', '颜色', '尺码']);
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
    expect(result.qr.sizeMm).toBe(maxQrSizeMm(TEMPLATE_LIMITS.paddingMm.max));
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

  test('leaves unknown variables and fields that were not recognised untouched', () => {
    expect(expandNoteText('质检 {工号} {订单号} {}', SCAN, new Date())).toBe('质检 {工号} {订单号} {}');
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
