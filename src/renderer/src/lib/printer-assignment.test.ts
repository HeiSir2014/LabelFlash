import { describe, expect, test } from 'bun:test';
import { STANDARD_TEMPLATE } from '../../../core/templates/builtin-templates';
import { PLATFORM_TWO_PART } from '../../../core/templates/builtin-waybills';
import {
  describeTemplatePrinter,
  describeTemplateUse,
  expectedPaperKey,
  paperRows,
  responsibilitiesOf,
  templateUses,
  withAssignment,
} from './printer-assignment';

const TEMPLATES = [
  { name: '样衣标准', paper: { widthMm: 60, heightMm: 40 }, printer: null },
  { name: '申通面单', paper: { widthMm: 100, heightMm: 180 }, printer: '面单机B' },
  { name: '极兔面单', paper: { widthMm: 100, heightMm: 180 }, printer: null },
  { name: '顺丰面单', paper: { widthMm: 100, heightMm: 150 }, printer: '面单机B' },
];
const INSTALLED = ['标签机A', '面单机B', '面单机C'];
const DRIVER_PAPER = {
  标签机A: { widthMm: 60, heightMm: 40, dpi: 203 },
  面单机C: { widthMm: 100, heightMm: 180, dpi: 203 },
};

describe('paperRows', () => {
  test('lists every paper the templates use, with its printer or a suggestion', () => {
    expect(paperRows(TEMPLATES, { '60x40': '标签机A' }, INSTALLED, DRIVER_PAPER)).toEqual([
      { key: '60x40', name: '60×40 标签', printer: '标签机A', suggestion: null, isMissing: false, isCovered: true },
      {
        key: '100x180',
        name: '100×180 二联面单',
        printer: null,
        suggestion: '面单机C',
        isMissing: false,
        isCovered: false,
      },
      // 只被「指定了本机打印机的模板」用到：不标红。
      { key: '100x150', name: '100×150 二联面单', printer: null, suggestion: null, isMissing: false, isCovered: true },
    ]);
  });

  test('keeps a paper that no template uses any more, so it can be cleared', () => {
    expect(paperRows([], { '70x50': '标签机A' }, INSTALLED, {})).toEqual([
      { key: '70x50', name: '70×50 标签', printer: '标签机A', suggestion: null, isMissing: false, isCovered: true },
    ]);
  });

  test('flags an assigned printer that is not on this computer', () => {
    expect(paperRows([], { '60x40': '旧打印机' }, INSTALLED, {})[0]?.isMissing).toBe(true);
  });

  test('does not suggest a printer already assigned to another paper', () => {
    const rows = paperRows(TEMPLATES, { '60x40': '面单机C' }, INSTALLED, DRIVER_PAPER);
    expect(rows.find((row) => row.key === '100x180')?.suggestion).toBeNull();
  });
});

describe('optional templates', () => {
  test('lists the paper of an optional template without flagging it', () => {
    const optional = { name: '内置面单', paper: { widthMm: 100, heightMm: 180 }, printer: null, optional: true };
    const rows = paperRows([optional], {}, INSTALLED, {});
    expect(rows).toEqual([
      { key: '100x180', name: '100×180 二联面单', printer: null, suggestion: null, isMissing: false, isCovered: true },
    ]);
  });

  test('treats built-in waybills as optional until they are active or bound to a rule', () => {
    const waybill = PLATFORM_TWO_PART;
    const optional = (activeId: string | null, boundId: string | null) =>
      templateUses([waybill, STANDARD_TEMPLATE], activeId, [
        { id: 'builtin:raw', enabled: true, templateId: boundId },
      ]).map((use) => use.optional);
    expect(optional(null, null)).toEqual([true, false]);
    expect(optional(waybill.id, null)).toEqual([false, false]);
    expect(optional(null, waybill.id)).toEqual([false, false]);
  });

  test('never treats a custom waybill as optional', () => {
    const copy = { ...PLATFORM_TWO_PART, id: 'custom:w1' };
    expect(templateUses([copy], null, [])[0]?.optional).toBe(false);
  });
});

describe('paperRows suggestions', () => {
  // 被模板指定的打印机装的是那个模板的纸：不再建议给别的纸。
  test('does not suggest a printer a template names', () => {
    const templates = [
      { name: '极兔面单', paper: { widthMm: 100, heightMm: 180 }, printer: null },
      { name: '申通面单', paper: { widthMm: 100, heightMm: 180 }, printer: '面单机C' },
    ];
    const rows = paperRows(templates, {}, INSTALLED, DRIVER_PAPER);
    expect(rows[0]?.suggestion).toBeNull();
  });
});

describe('describeTemplatePrinter with display names', () => {
  test('shows the name the system displays', () => {
    const label = { paper: { widthMm: 60, heightMm: 40 }, printer: null };
    expect(describeTemplatePrinter(label, { '60x40': 'Label_Printer_01' }, ['Label_Printer_01'], () => '标签机A')).toBe(
      '标签机A',
    );
  });
});

describe('responsibilitiesOf', () => {
  test('lists the papers and templates a printer handles', () => {
    expect(responsibilitiesOf('面单机B', TEMPLATES, { '60x40': '标签机A' })).toEqual({
      papers: [],
      templates: [
        { name: '申通面单', paperKey: '100x180' },
        { name: '顺丰面单', paperKey: '100x150' },
      ],
    });
    expect(responsibilitiesOf('标签机A', TEMPLATES, { '60x40': '标签机A' })).toEqual({
      papers: [{ key: '60x40', name: '60×40 标签' }],
      templates: [],
    });
  });
});

describe('expectedPaperKey', () => {
  // 测试页和驱动纸张提醒都按这台打印机应该装的纸：纸张分配优先，其次是指定了它的模板。
  test('prefers an assigned paper, then a template that names the printer', () => {
    expect(expectedPaperKey(responsibilitiesOf('标签机A', TEMPLATES, { '60x40': '标签机A' }))).toBe('60x40');
    expect(expectedPaperKey(responsibilitiesOf('面单机B', TEMPLATES, {}))).toBe('100x180');
    expect(expectedPaperKey(responsibilitiesOf('面单机C', TEMPLATES, {}))).toBeNull();
  });
});

describe('withAssignment', () => {
  test('assigns and clears a paper without touching the others', () => {
    expect(withAssignment({ '60x40': 'A' }, '100x180', 'B')).toEqual({ '60x40': 'A', '100x180': 'B' });
    expect(withAssignment({ '60x40': 'A', '100x180': 'B' }, '100x180', null)).toEqual({ '60x40': 'A' });
  });
});

describe('describeTemplatePrinter', () => {
  const label = { paper: { widthMm: 60, heightMm: 40 }, printer: null };

  test('describes the printer a template will actually use', () => {
    expect(describeTemplatePrinter(label, { '60x40': 'A' }, ['A'])).toBe('A');
    expect(describeTemplatePrinter(label, {}, ['A'])).toBe('还没有打印机');
    expect(describeTemplatePrinter({ ...label, printer: 'B' }, { '60x40': 'A' }, ['A'])).toBe(
      'A（指定的 B 不在这台电脑上）',
    );
  });
});

describe('describeTemplateUse', () => {
  const label = { paper: { widthMm: 60, heightMm: 40 }, printer: null };
  const waybill = { paper: { widthMm: 100, heightMm: 180 }, printer: null };

  // 模板列表每一行都写「60×40 标签 · 还没有打印机」是噪音：默认纸张、按纸张分配的，只写模板名。
  test('says nothing for a template on the default paper that follows the paper assignment', () => {
    expect(describeTemplateUse(label, {}, ['A'])).toBeNull();
    expect(describeTemplateUse(label, { '60x40': 'A' }, ['A'])).toBeNull();
  });

  test('names another paper and where it prints', () => {
    expect(describeTemplateUse(waybill, { '100x180': 'B' }, ['B'])).toBe('100×180 二联面单 · B');
    expect(describeTemplateUse(waybill, {}, ['B'])).toBe('100×180 二联面单 · 还没有打印机');
  });

  test('names the printer a template chooses itself', () => {
    expect(describeTemplateUse({ ...label, printer: 'C' }, {}, ['C'])).toBe('C');
    expect(describeTemplateUse({ ...label, printer: 'D' }, { '60x40': 'A' }, ['A'])).toBe(
      'A（指定的 D 不在这台电脑上）',
    );
  });
});
