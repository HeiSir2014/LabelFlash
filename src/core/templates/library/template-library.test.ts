import { describe, expect, test } from 'bun:test';
import { findPreset, paperKey } from '../../../shared/paper-sizes';
import { templateFields } from '../../api/template-fields';
import { SERIAL_FIELD } from '../../batch/batch-model';
import { autoMapping, mappableVariables } from '../../batch/column-mapping';
import { BUILT_IN_RULES, DASH_THREE_RULE_ID, SHELF_NUMBER_FIELD } from '../../scan/builtin-rules';
import { GENERIC_TEMPLATE } from '../builtin-templates';
import { layoutCanvas } from '../canvas-layout';
import { sanitizeTemplate } from '../sanitize-template';
import { TEMPLATE_ID_PATTERN, TEMPLATE_LIMITS } from '../template-model';
import {
  LIBRARY_CATEGORIES,
  LIBRARY_FIELD_NAMES,
  LIBRARY_TEMPLATE_ID_PATTERN,
  type LibraryEntry,
  librarySampleScan,
} from './library-model';
import { findLibraryEntry, TEMPLATE_LIBRARY } from './template-library';

/** 设计文档第 4 节定的每类个数。 */
const EXPECTED_COUNTS: Readonly<Record<string, number>> = {
  garment: 3,
  price: 3,
  barcode: 3,
  'shoe-box': 2,
  food: 2,
  jewelry: 2,
  warehouse: 3,
};
/** 设计文档第 4 节要覆盖的纸张。 */
const EXPECTED_PAPERS = ['30x20', '40x30', '50x30', '60x40', '70x50', '100x100', '100x150'];
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

  test('covers every paper size of the design', () => {
    const papers = new Set(TEMPLATE_LIBRARY.map((entry) => paperKey(entry.template.paper)));
    expect([...papers].sort()).toEqual([...EXPECTED_PAPERS].sort());
  });

  test('lists the templates in the order of the categories', () => {
    const order: readonly string[] = LIBRARY_CATEGORIES.map((category) => category.id);
    const positions = TEMPLATE_LIBRARY.map((entry) => order.indexOf(entry.category));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  test('uses every shared field name somewhere', () => {
    const used = new Set(TEMPLATE_LIBRARY.flatMap((entry) => templateFields(entry.template).names));
    expect(LIBRARY_FIELD_NAMES.filter((name) => !used.has(name))).toEqual([]);
  });

  // 扫样衣码、手机读货架号、批量打印的序号、「多行键值」的数量：模板库用的是同样的写法。
  test('spells fields like the built-in rules and batch printing do', () => {
    const dashThree = BUILT_IN_RULES.find((rule) => rule.id === DASH_THREE_RULE_ID);
    const ruleFields = dashThree?.kind === 'delimited' ? dashThree.fields : [];
    expect(ruleFields).toEqual(['编码', '颜色', '尺码']);
    const expected = [...ruleFields, SHELF_NUMBER_FIELD, SERIAL_FIELD, '数量'];
    expect(expected.filter((name) => !LIBRARY_FIELD_NAMES.includes(name))).toEqual([]);
  });

  // 批量打印按列名自动对列：Excel 表头写统一的字段名，每个模板的每个变量都能自动对上。
  test('maps every variable automatically from a sheet headed with the shared field names', () => {
    const unmapped = TEMPLATE_LIBRARY.flatMap((entry) =>
      Object.entries(autoMapping(mappableVariables(templateFields(entry.template)), LIBRARY_FIELD_NAMES))
        .filter(([, source]) => source.kind !== 'column')
        .map(([name]) => `${entry.template.name}：${name}`),
    );
    expect(unmapped).toEqual([]);
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
