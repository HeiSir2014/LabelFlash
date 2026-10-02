import { describe, expect, test } from 'bun:test';
import { findPreset } from '../../../shared/paper-sizes';
import { templateFields } from '../../api/template-fields';
import { GENERIC_TEMPLATE } from '../builtin-templates';
import { layoutCanvas } from '../canvas-layout';
import { sanitizeTemplate } from '../sanitize-template';
import { TEMPLATE_ID_PATTERN, TEMPLATE_LIMITS } from '../template-model';
import {
  LIBRARY_FIELD_NAMES,
  LIBRARY_TEMPLATE_ID_PATTERN,
  type LibraryEntry,
  librarySampleScan,
} from './library-model';
import { findLibraryEntry, TEMPLATE_LIBRARY } from './template-library';

/** 设计文档第 4 节定的每类个数（Task 4 补上其余四类）。 */
const EXPECTED_COUNTS: Readonly<Record<string, number>> = { garment: 3, price: 3, barcode: 3 };
/** 热敏标签机常见的两种分辨率：条码模块、文字、格线取整到点之后，两种都要排得下。 */
const DPIS = [203, 300] as const;
const MM_PER_INCH = 25.4;
// 本地时间：{日期} 按本地时区显示（和标签快照一样的理由）。
const PRINTED_AT = new Date(2026, 9, 2, 9, 5);

function countByCategory(entries: readonly LibraryEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    counts[entry.category] = (counts[entry.category] ?? 0) + 1;
  }
  return counts;
}

describe('template library', () => {
  test('has the planned number of templates in each category', () => {
    expect(countByCategory(TEMPLATE_LIBRARY)).toEqual(EXPECTED_COUNTS);
  });

  test('gives every template a unique library id that the template list does not accept', () => {
    const ids = TEMPLATE_LIBRARY.map((entry) => entry.template.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => !LIBRARY_TEMPLATE_ID_PATTERN.test(id) || TEMPLATE_ID_PATTERN.test(id))).toEqual([]);
  });

  test('finds a template by its library id only', () => {
    const [first] = TEMPLATE_LIBRARY;
    expect(first === undefined ? null : findLibraryEntry(first.template.id)).toBe(first ?? null);
    expect(findLibraryEntry('library:nope')).toBeNull();
    expect(findLibraryEntry('builtin:canvas-tag')).toBeNull();
  });

  for (const { template, sample } of TEMPLATE_LIBRARY) {
    describe(template.name, () => {
      test('fits the template name limit and sits on a preset paper', () => {
        expect(template.name.length).toBeLessThanOrEqual(TEMPLATE_LIMITS.nameLength);
        expect(findPreset(template.paper)).not.toBeNull();
      });

      // 和用户保存的模板过同一个校验器：模板库里没有校验器会改掉的东西（超出纸张、超限、码制不认识……）。
      test('comes out of the user template sanitizer unchanged', () => {
        expect(sanitizeTemplate(structuredClone(template), template.id, GENERIC_TEMPLATE)).toEqual(template);
      });

      test('has a non-empty sample value for exactly the fields it prints', () => {
        expect(sample.fields.map((field) => field.name).sort()).toEqual([...templateFields(template).names].sort());
        expect(sample.fields.filter((field) => field.value.trim() === '')).toEqual([]);
      });

      test('uses only the shared field names', () => {
        expect(templateFields(template).names.filter((name) => !LIBRARY_FIELD_NAMES.includes(name))).toEqual([]);
      });

      // 示例数据排出来：每个元素都在（没有「这一张没有内容」）、不靠近纸边、文字表格都放得下。
      test.each([...DPIS])('lays out the sample with every element and no issue at %i dpi', (dpi) => {
        const layout = layoutCanvas(template, {
          scan: librarySampleScan(sample),
          printedAt: PRINTED_AT,
          dotMm: MM_PER_INCH / dpi,
        });
        expect(layout.issues).toEqual([]);
        expect(layout.overflowCount).toBe(0);
        expect(layout.elements).toHaveLength(template.elements.length);
      });
    });
  }
});
