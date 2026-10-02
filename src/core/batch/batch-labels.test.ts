import { describe, expect, test } from 'bun:test';
import type { TemplateFields } from '../api/template-fields';
import { labelForRow, planLabels } from './batch-labels';
import { BATCH_LIMITS, type BatchPlan, type BatchTable, DEFAULT_COPIES, DEFAULT_SERIAL } from './batch-model';

const TABLE_ID = '00000000-0000-4000-8000-000000000001';
const PICKED: TemplateFields = { mode: 'PICKED', names: ['编码', '颜色', '序号'] };
const ALL: TemplateFields = { mode: 'ALL', names: [] };
const TABLE: BatchTable = {
  id: TABLE_ID,
  name: 'rows.csv',
  columns: ['编码', '颜色', '份数'],
  rows: [
    ['CL1', '红', '2'],
    ['CL2', '', ''],
    ['CL3', '黑', 'x'],
  ],
};

function plan(overrides: Partial<BatchPlan> = {}): BatchPlan {
  return {
    templateId: 'builtin:canvas-tag',
    data: { kind: 'table', tableId: TABLE_ID },
    mapping: { 编码: { kind: 'column', column: '编码' }, 颜色: { kind: 'column', column: '颜色' } },
    serial: { ...DEFAULT_SERIAL, enabled: true, prefix: 'A', digits: 3 },
    copies: DEFAULT_COPIES,
    rows: null,
    ...overrides,
  };
}

function okPlan(result: ReturnType<typeof planLabels>) {
  if (!result.ok) {
    throw new Error(result.issue);
  }
  return result;
}

describe('planLabels', () => {
  test('makes one label per row with the mapped fields and a serial', () => {
    const { labels, rowCount } = okPlan(planLabels({ table: TABLE, plan: plan(), fields: PICKED }));
    expect(rowCount).toBe(3);
    expect(labels.map((label) => [label.row, label.copy, label.fields])).toEqual([
      [
        1,
        1,
        [
          { name: '编码', value: 'CL1' },
          { name: '颜色', value: '红' },
          { name: '序号', value: 'A001' },
        ],
      ],
      [
        2,
        1,
        [
          { name: '编码', value: 'CL2' },
          { name: '序号', value: 'A002' },
        ],
      ],
      [
        3,
        1,
        [
          { name: '编码', value: 'CL3' },
          { name: '颜色', value: '黑' },
          { name: '序号', value: 'A003' },
        ],
      ],
    ]);
    expect(labels[0]?.content).toBe('编码：CL1\n颜色：红\n序号：A001');
  });

  // 缺字段的行照样打（这一项空着），只是标黄提醒。
  test('flags an empty mapped cell but still prints the row', () => {
    const { labels, problems } = okPlan(planLabels({ table: TABLE, plan: plan(), fields: PICKED }));
    expect(labels).toHaveLength(3);
    expect(problems).toEqual([{ row: 2, texts: ['缺：颜色'] }]);
  });

  test('numbers serials in the order of the rows to print', () => {
    const { labels } = okPlan(planLabels({ table: TABLE, plan: plan({ rows: [2, 0] }), fields: PICKED }));
    expect(labels.map((label) => [label.row, label.fields.at(-1)?.value])).toEqual([
      [1, 'A001'],
      [3, 'A002'],
    ]);
  });

  test('uses fixed values and leaves an empty fixed value out without a problem', () => {
    const mapping = { 编码: { kind: 'fixed', value: '固定' }, 颜色: { kind: 'fixed', value: '' } } as const;
    const { labels, problems } = okPlan(planLabels({ table: TABLE, plan: plan({ mapping }), fields: PICKED }));
    expect(labels[0]?.fields).toEqual([
      { name: '编码', value: '固定' },
      { name: '序号', value: 'A001' },
    ]);
    expect(problems).toEqual([]);
  });

  test('prints every non-empty column for templates that show all fields', () => {
    const { labels } = okPlan(planLabels({ table: TABLE, plan: plan({ mapping: {} }), fields: ALL }));
    expect(labels[1]?.fields).toEqual([
      { name: '编码', value: 'CL2' },
      { name: '序号', value: 'A002' },
    ]);
  });

  test('takes copies from a column: blank is one, zero and junk skip the row', () => {
    const { labels, problems } = okPlan(
      planLabels({ table: TABLE, plan: plan({ copies: { kind: 'column', column: '份数' } }), fields: PICKED }),
    );
    expect(labels.map((label) => [label.row, label.copy])).toEqual([
      [1, 1],
      [1, 2],
      [2, 1],
    ]);
    expect(problems).toContainEqual({
      row: 3,
      texts: [`份数「x」不对：应为 0–${BATCH_LIMITS.copiesPerRow} 的整数，这一行不打`],
    });
  });

  test('takes the serial from a column and flags an empty one', () => {
    const serial = { ...DEFAULT_SERIAL, enabled: true, column: '颜色' };
    const { labels, problems } = okPlan(planLabels({ table: TABLE, plan: plan({ serial }), fields: PICKED }));
    expect(labels[0]?.fields.at(-1)).toEqual({ name: '序号', value: '红' });
    expect(problems).toEqual([{ row: 2, texts: ['缺：颜色', '序号为空'] }]);
  });

  test('prints N serial-only labels without a table', () => {
    const serialOnly = plan({ data: { kind: 'serial-only', count: 3 }, mapping: {} });
    const { labels } = okPlan(planLabels({ table: null, plan: serialOnly, fields: PICKED }));
    expect(labels.map((label) => label.fields)).toEqual([
      [{ name: '序号', value: 'A001' }],
      [{ name: '序号', value: 'A002' }],
      [{ name: '序号', value: 'A003' }],
    ]);
  });

  test('refuses more labels than one batch may hold', () => {
    const rowsNeeded = BATCH_LIMITS.labels / BATCH_LIMITS.copiesPerRow + 1;
    const big: BatchTable = { ...TABLE, rows: Array.from({ length: rowsNeeded }, (_, i) => [`CL${i}`, '红', '1']) };
    const copies = { kind: 'fixed', count: BATCH_LIMITS.copiesPerRow } as const;
    expect(planLabels({ table: big, plan: plan({ copies }), fields: PICKED })).toEqual({
      ok: false,
      issue: `一批最多 ${BATCH_LIMITS.labels} 张：请减少份数或分几批打`,
    });
  });

  // 份数为 0（或解析不了）的行不打印，也不该占用一个序号：否则序号会和实际打出来的张数对不上。
  test('does not spend a serial number on a row that prints zero copies', () => {
    const table: BatchTable = {
      id: TABLE_ID,
      name: 'r.csv',
      columns: ['编码', '份数'],
      rows: [
        ['A', '1'],
        ['B', '0'],
        ['C', '1'],
      ],
    };
    const withCopiesColumn = plan({
      mapping: { 编码: { kind: 'column', column: '编码' } },
      copies: { kind: 'column', column: '份数' },
    });
    const { labels } = okPlan(planLabels({ table, plan: withCopiesColumn, fields: PICKED }));
    expect(labels.map((label) => [label.row, label.fields.at(-1)?.value])).toEqual([
      [1, 'A001'],
      [3, 'A002'],
    ]);
  });

  test('excludes the copies and serial source columns when a template shows all fields', () => {
    const table: BatchTable = {
      id: TABLE_ID,
      name: 'r.csv',
      columns: ['编码', '份数', '货架号'],
      rows: [['CL1', '2', 'A-01']],
    };
    const withControls = plan({
      mapping: {},
      copies: { kind: 'column', column: '份数' },
      serial: { ...DEFAULT_SERIAL, enabled: true, column: '货架号' },
    });
    const { labels } = okPlan(planLabels({ table, plan: withControls, fields: ALL }));
    expect(labels[0]?.fields).toEqual([
      { name: '编码', value: 'CL1' },
      { name: '序号', value: 'A-01' },
    ]);
  });
});

describe('labelForRow', () => {
  test('numbers a row after the selected rows before it, selected or not', () => {
    const input = { table: TABLE, plan: plan({ rows: [0, 2] }), fields: PICKED };
    expect(labelForRow(input, 2)?.fields.at(-1)?.value).toBe('A002');
    expect(labelForRow(input, 1)?.fields.at(-1)?.value).toBe('A002');
    expect(labelForRow(input, 3)).toBeNull();
  });

  // 预览和实际打印必须用同一套序号规则：份数为 0 的行不占序号，预览也要跳过它。
  test('matches planLabels when a row between prints zero copies', () => {
    const table: BatchTable = {
      id: TABLE_ID,
      name: 'r.csv',
      columns: ['编码', '份数'],
      rows: [
        ['A', '1'],
        ['B', '0'],
        ['C', '1'],
      ],
    };
    const withCopiesColumn = plan({
      mapping: { 编码: { kind: 'column', column: '编码' } },
      copies: { kind: 'column', column: '份数' },
    });
    const input = { table, plan: withCopiesColumn, fields: PICKED };
    expect(labelForRow(input, 2)?.fields.at(-1)?.value).toBe('A002');
  });
});
