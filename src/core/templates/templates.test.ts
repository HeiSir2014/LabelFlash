import { describe, expect, test } from 'bun:test';
import { BUILT_IN_TEMPLATES, STANDARD_TEMPLATE } from './builtin-templates';
import { expandNoteText } from './note-text';
import { sanitizeTemplate } from './sanitize-template';
import { TemplateCatalog, TemplateError, type TemplateRepository } from './template-catalog';
import {
  CUSTOM_TEMPLATE_PREFIX,
  isBuiltInTemplateId,
  type LabelTemplate,
  maxQrSizeMm,
  TEMPLATE_ID_PATTERN,
  TEMPLATE_LIMITS,
} from './template-model';
import { estimateTextWidthEm, fitFontSizeMm } from './text-fit';

const LABEL = { raw: 'CL5640-TK-图片色-XXL', code: 'CL5640-TK', color: '图片色', size: 'XXL' };

class MemoryRepository implements TemplateRepository {
  readonly saved = new Map<string, LabelTemplate>();

  listCustom(): LabelTemplate[] {
    return [...this.saved.values()];
  }

  save(template: LabelTemplate): void {
    this.saved.set(template.id, template);
  }

  remove(id: string): void {
    this.saved.delete(id);
  }
}

function createCatalog() {
  const repository = new MemoryRepository();
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
      { paddingMm: 50, qr: { sizeMm: 500 }, fields: { code: { fontSizeMm: 0.1 } } },
      'custom:1',
      STANDARD_TEMPLATE,
    );
    expect(result.paddingMm).toBe(TEMPLATE_LIMITS.paddingMm.max);
    expect(result.qr.sizeMm).toBe(maxQrSizeMm(TEMPLATE_LIMITS.paddingMm.max));
    expect(result.fields.code.fontSizeMm).toBe(TEMPLATE_LIMITS.fontSizeMm.min);
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
  test('replaces every supported variable with local date and time', () => {
    const printedAt = new Date(2026, 8, 28, 9, 5);
    expect(expandNoteText('{编码}/{颜色}/{尺码}/{完整编码} {日期} {时间}', LABEL, printedAt)).toBe(
      'CL5640-TK/图片色/XXL/CL5640-TK-图片色-XXL 2026-09-28 09:05',
    );
  });

  test('leaves unknown variables untouched', () => {
    expect(expandNoteText('质检 {工号}', LABEL, new Date())).toBe('质检 {工号}');
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
    copy.fields.code.prefix = 'changed';
    expect(STANDARD_TEMPLATE.fields.code.prefix).toBe('编码：');
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

  test('resolve falls back to the standard template', () => {
    const { catalog } = createCatalog();
    expect(catalog.resolve('custom:deleted')).toBe(STANDARD_TEMPLATE);
  });
});

describe('fitFontSizeMm', () => {
  test('counts CJK characters as wide and Latin as narrow', () => {
    expect(estimateTextWidthEm('图片色')).toBe(3);
    expect(estimateTextWidthEm('CL')).toBeCloseTo(1.24);
  });

  test('keeps the font size when the text fits', () => {
    expect(fitFontSizeMm('CL5640-TK', 3.2, 30, 1)).toBe(3.2);
  });

  test('shrinks long text to fit the allowed lines, never below the minimum', () => {
    const long = 'C'.repeat(80);
    const fitted = fitFontSizeMm(long, 3, 55, 2);
    expect(fitted).toBeLessThan(3);
    expect(estimateTextWidthEm(long) * fitted).toBeLessThanOrEqual(55 * 2);
    expect(fitFontSizeMm('C'.repeat(1_000), 3, 55, 1)).toBe(TEMPLATE_LIMITS.fontSizeMm.min);
  });
});
