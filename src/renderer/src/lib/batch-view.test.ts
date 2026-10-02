import { describe, expect, test } from 'bun:test';
import type { TemplateFields } from '../../../core/api/template-fields';
import { type BatchTable, DEFAULT_COPIES, DEFAULT_SERIAL } from '../../../core/batch/batch-model';
import type { BatchStatus } from '../../../shared/batch';
import {
  BATCH_ROW_HEIGHT_PX,
  batchButtonProgress,
  buildPlan,
  describePauseReason,
  describeProgress,
  describeSummary,
  describeTable,
  failuresByRow,
  filterRows,
  historyLimitWarning,
  isSerialEnabled,
  type PlanInput,
  problemsByRow,
  serialExample,
  sourceFromKey,
  sourceKey,
  stepRowIndex,
  toggledSelection,
  visibleRange,
  withRowsChecked,
} from './batch-view';

const TABLE: BatchTable = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'rows.csv',
  columns: ['编码', '颜色'],
  rows: [
    ['CL1', '红'],
    ['CL2', '蓝'],
    ['XY3', '红'],
  ],
};
const PICKED: TemplateFields = { mode: 'PICKED', names: ['编码', '序号'] };
const ALL: TemplateFields = { mode: 'ALL', names: [] };

function status(overrides: Partial<BatchStatus> = {}): BatchStatus {
  return {
    batchId: '20261002-143501-a1b2',
    state: 'running',
    total: 120,
    sent: 35,
    failed: 0,
    pauseReason: null,
    failures: [],
    templateName: '吊牌',
    ...overrides,
  };
}

function input(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    templateId: 'builtin:canvas-tag',
    fields: PICKED,
    dataKind: 'table',
    table: TABLE,
    serialOnlyCount: 10,
    mapping: { 编码: { kind: 'column', column: '编码' }, 颜色: { kind: 'column', column: '旧列' } },
    serial: { ...DEFAULT_SERIAL, column: '旧列' },
    wantsSerial: false,
    copies: { kind: 'column', column: '旧列' },
    selected: new Set([2, 0]),
    ...overrides,
  };
}

describe('buildPlan', () => {
  // 换了表格之后，旧表的列名不能交给主进程：主进程严格核对，会把整个设置退回。
  test('drops columns that are not in the current table and sorts the chosen rows', () => {
    expect(buildPlan(input())).toEqual({
      templateId: 'builtin:canvas-tag',
      data: { kind: 'table', tableId: TABLE.id },
      mapping: { 编码: { kind: 'column', column: '编码' }, 颜色: { kind: 'none' } },
      serial: { ...DEFAULT_SERIAL, enabled: true, column: null },
      copies: DEFAULT_COPIES,
      rows: [0, 2],
    });
  });

  test('prints serials only without a table, and nothing before a table is loaded', () => {
    expect(buildPlan(input({ dataKind: 'serial-only' }))).toMatchObject({
      data: { kind: 'serial-only', count: 10 },
      rows: null,
    });
    expect(buildPlan(input({ table: null }))).toBeNull();
  });
});

describe('isSerialEnabled', () => {
  test('follows the template, the switch for all-field templates, and serial-only printing', () => {
    expect(isSerialEnabled(PICKED, false, true)).toBe(true);
    expect(isSerialEnabled({ mode: 'PICKED', names: ['编码'] }, true, true)).toBe(false);
    expect(isSerialEnabled(ALL, false, true)).toBe(false);
    expect(isSerialEnabled(ALL, true, true)).toBe(true);
    expect(isSerialEnabled(ALL, false, false)).toBe(true);
  });
});

describe('rows', () => {
  test('filters rows by any cell, ignoring case', () => {
    expect(filterRows(TABLE, 3, ' xy ')).toEqual([2]);
    expect(filterRows(TABLE, 3, '红')).toEqual([0, 2]);
    expect(filterRows(null, 2, 'x')).toEqual([0, 1]);
  });

  test('draws only the rows in view, with some spare rows around them', () => {
    expect(visibleRange(0, BATCH_ROW_HEIGHT_PX * 10, 1_000)).toEqual({ start: 0, end: 20 });
    expect(visibleRange(BATCH_ROW_HEIGHT_PX * 100, BATCH_ROW_HEIGHT_PX * 10, 1_000)).toEqual({ start: 90, end: 120 });
    expect(visibleRange(0, BATCH_ROW_HEIGHT_PX * 10, 5)).toEqual({ start: 0, end: 5 });
  });

  // 一万行的表：视野之外的行不该被画出来（虚拟滚动的核心保证），不管表有多大都只画视野附近那几十行。
  test('draws a small, constant window even with ten thousand rows', () => {
    const total = 10_000;
    expect(visibleRange(0, BATCH_ROW_HEIGHT_PX * 20, total)).toEqual({ start: 0, end: 30 });
    const middle = visibleRange(BATCH_ROW_HEIGHT_PX * 5_000, BATCH_ROW_HEIGHT_PX * 20, total);
    expect(middle.end - middle.start).toBeLessThan(60);
    expect(middle.start).toBeGreaterThan(0);
    expect(middle.end).toBeLessThan(total);
    const atEnd = visibleRange(BATCH_ROW_HEIGHT_PX * (total - 10), BATCH_ROW_HEIGHT_PX * 20, total);
    expect(atEnd.end).toBe(total);
  });

  test('keeps "all rows" as null and switches rows on and off', () => {
    const one = toggledSelection(null, 1, 3);
    expect(one === null ? null : [...one]).toEqual([0, 2]);
    expect(toggledSelection(one, 1, 3)).toBeNull();
    const none = withRowsChecked(null, [0, 1, 2], false, 3);
    expect(none === null ? null : [...none]).toEqual([]);
  });

  test('steps through the rows in view', () => {
    expect(stepRowIndex([0, 2, 5], 2, 1)).toBe(5);
    expect(stepRowIndex([0, 2, 5], 5, 1)).toBe(5);
    expect(stepRowIndex([0, 2, 5], 2, -1)).toBe(0);
    expect(stepRowIndex([0, 2, 5], 3, 1)).toBe(0);
  });
});

describe('texts', () => {
  test('summarizes the table, the selection and the problems', () => {
    expect(describeTable(TABLE)).toBe('rows.csv · 3 行 · 2 列');
    expect(describeTable(null)).toBe('还没有导入数据');
    expect(describeSummary({ rowCount: 120, selectedCount: 118, labelCount: 236, problemRows: 3 })).toBe(
      '共 120 行 · 选中 118 行 · 打 236 张 · 3 行有问题（标黄）',
    );
    expect(describeSummary({ rowCount: 3, selectedCount: 3, labelCount: 3, problemRows: 0 })).toBe('共 3 行 · 打 3 张');
  });

  test('describes the progress of a batch in every state', () => {
    expect(describeProgress(status())).toEqual({ text: '正在打印 · 已发送 35 / 120 张', percent: 29 });
    expect(describeProgress(status({ state: 'paused', pauseReason: 'PRINTER_NOT_READY' })).text).toBe(
      '已暂停（打印机现在不能打印：缺纸、离线或卡纸，处理好后点继续）· 已发送 35 / 120 张',
    );
    expect(describeProgress(status({ state: 'canceled', failed: 2 })).text).toBe(
      '已取消 · 已发送 35 / 120 张 · 失败 2 张',
    );
    expect(describeProgress(status({ state: 'done', sent: 120 })).text).toBe('全部已发送 · 已发送 120 / 120 张');
    expect(describeProgress(status({ state: 'done', sent: 118, failed: 2 })).text).toBe(
      '已结束 · 已发送 118 / 120 张 · 失败 2 张',
    );
  });

  // 连续失败自动暂停的两种原因：措辞不一样，超时那种要提醒操作员自己确认有没有出纸，不能直接当成没打。
  test('explains the two consecutive-failure pause reasons differently', () => {
    expect(describePauseReason('consecutive-failures')).toBe('连续几张都没打印成功：检查打印机后点继续');
    expect(describePauseReason('consecutive-failures-after-timeout')).toBe(
      '最后一张可能已经打出来了：看一眼打印机，确认后点继续',
    );
  });

  test('shows progress on the title bar button only while a batch runs or waits', () => {
    expect(batchButtonProgress(status({ failed: 1 }))).toBe('36/120');
    expect(batchButtonProgress(status({ state: 'done' }))).toBeNull();
    expect(batchButtonProgress(null)).toBeNull();
  });

  test('shows the first serials as an example', () => {
    expect(serialExample({ ...DEFAULT_SERIAL, prefix: 'A', digits: 3 })).toBe('A001、A002、A003');
  });

  // 一批的张数比打印记录保留的条数还多：多出来的部分打完就不在记录里了，提醒操作员。
  test('warns only when a batch would outgrow the kept print history', () => {
    expect(historyLimitWarning(100, 1_000)).toBeNull();
    expect(historyLimitWarning(1_000, 1_000)).toBeNull();
    expect(historyLimitWarning(1_200, 1_000)).toBe(
      '这一批 1,200 张比打印记录保留的 1,000 条多：多出的部分会被自动顶掉，重启后整批重打失败的可能会漏掉这些行',
    );
  });
});

describe('maps', () => {
  test('merges problems of the same row', () => {
    const merged = problemsByRow([{ row: 2, texts: ['缺：颜色'] }], [{ row: 2, texts: ['条码不印'] }]);
    expect(merged.get(2)).toEqual(['缺：颜色', '条码不印']);
  });

  test('groups failures by row', () => {
    const failures = [
      { row: 3, copy: 1, reason: 'PRINT_ERROR' as const },
      { row: 3, copy: 2, reason: 'PRINT_TIMEOUT' as const },
    ];
    expect(failuresByRow(status({ failures })).get(3)).toHaveLength(2);
    expect(failuresByRow(null).size).toBe(0);
  });

  test('turns mapping choices into option keys and back', () => {
    expect(sourceKey({ kind: 'column', column: '编码' })).toBe('column:编码');
    expect(sourceFromKey('column:编码', { kind: 'none' })).toEqual({ kind: 'column', column: '编码' });
    expect(sourceFromKey('fixed', { kind: 'fixed', value: 'x' })).toEqual({ kind: 'fixed', value: 'x' });
    expect(sourceFromKey('fixed', { kind: 'none' })).toEqual({ kind: 'fixed', value: '' });
    expect(sourceFromKey('none', { kind: 'fixed', value: 'x' })).toEqual({ kind: 'none' });
  });
});
