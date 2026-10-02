import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type BatchPlan, DEFAULT_COPIES, DEFAULT_SERIAL } from '../../core/batch/batch-model';
import type { FieldsPrint } from '../../core/print-service';
import { CANVAS_TAG } from '../../core/templates/builtin-canvas';
import type { JobRecord, PrintResult } from '../../core/types';
import type { BatchStatus } from '../../shared/batch';
import { DEFAULT_PAPER } from '../../shared/label-paper';
import { NO_RENDER_WARNINGS } from '../../shared/render-warnings';
import { createTempDir, removeTempDir } from '../storage/testing/temp-dir';
import { BatchStation, type BatchStationDeps } from './batch-station';
import { XLS_ISSUE } from './table-file';
import { minimalXlsx } from './testing/minimal-xlsx';

const BATCH_ID = '20261002-143501-a1b2';
const PRINTED: PrintResult = {
  status: 'printed',
  jobId: 'j',
  scan: { raw: '', ruleId: 'batch', ruleName: '批量打印', fields: [] },
};

function createStation(overrides: Partial<BatchStationDeps> = {}) {
  const printed: FieldsPrint[] = [];
  const statuses: (BatchStatus | null)[] = [];
  const scheduled: (() => void)[] = [];
  let tables = 0;
  const deps: BatchStationDeps = {
    readTable: async () => ({
      ok: true,
      records: [
        ['编码', '颜色'],
        ['CL1', '红'],
        ['BAD', ''],
      ],
    }),
    findTemplate: (id) => (id === CANVAS_TAG.id ? CANVAS_TAG : null),
    printFields: async (input) => {
      printed.push(input);
      return PRINTED;
    },
    dpiFor: async () => 203,
    render: (_template, label) => ({
      html: `<p>${label.content}</p>`,
      warnings: label.fields.some((field) => field.value === 'BAD')
        ? { ...NO_RENDER_WARNINGS, issues: ['条码「商品码」不印：位数不对'] }
        : NO_RENDER_WARNINGS,
      paper: DEFAULT_PAPER,
    }),
    failedJobs: () => [],
    createTableId: () => `00000000-0000-4000-8000-00000000000${++tables}`,
    createBatchId: () => BATCH_ID,
    schedule: (run) => {
      scheduled.push(run);
      return () => {
        scheduled.splice(scheduled.indexOf(run), 1);
      };
    },
    onStatus: (status) => statuses.push(status),
    onJobsChanged: () => undefined,
    ...overrides,
  };
  return { station: new BatchStation(deps), printed, statuses, scheduled };
}

function planFor(tableId: string, overrides: Partial<BatchPlan> = {}): BatchPlan {
  return {
    templateId: CANVAS_TAG.id,
    data: { kind: 'table', tableId },
    mapping: { 编码: { kind: 'column', column: '编码' }, 颜色: { kind: 'column', column: '颜色' } },
    serial: DEFAULT_SERIAL,
    copies: DEFAULT_COPIES,
    rows: null,
    ...overrides,
  };
}

async function loaded(station: BatchStation): Promise<string> {
  const result = await station.loadBytes('rows.csv', new TextEncoder().encode('ignored by the fake reader'));
  if (result.status !== 'loaded') {
    throw new Error(`table not loaded: ${JSON.stringify(result)}`);
  }
  return result.table.id;
}

describe('BatchStation tables', () => {
  test('reads a file through the reader and keeps the table', async () => {
    const { station } = createStation();
    expect(await station.loadBytes('rows.csv', new Uint8Array([0x61]))).toEqual({
      status: 'loaded',
      table: {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'rows.csv',
        columns: ['编码', '颜色'],
        rows: [
          ['CL1', '红'],
          ['BAD', ''],
        ],
      },
    });
  });

  test('refuses .xls before starting a reader', async () => {
    let reads = 0;
    const { station } = createStation({
      readTable: async () => {
        reads += 1;
        return { ok: true, records: [] };
      },
    });
    expect(await station.loadBytes('old.xls', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toEqual({
      status: 'invalid',
      issue: XLS_ISSUE,
    });
    expect(reads).toBe(0);
  });

  test('checks the header of what the reader returns', async () => {
    const { station } = createStation({ readTable: async () => ({ ok: true, records: [['编码', '编码']] }) });
    expect(await station.loadBytes('rows.csv', new Uint8Array([0x61]))).toEqual({
      status: 'invalid',
      issue: '列名重复：「编码」',
    });
  });

  test('parses a table pasted from Excel', () => {
    const { station } = createStation();
    expect(station.paste('编码\t颜色\nCL9\t灰\n')).toMatchObject({
      status: 'loaded',
      table: { name: '粘贴的数据', columns: ['编码', '颜色'], rows: [['CL9', '灰']] },
    });
  });

  describe('from a path', () => {
    let dir: string;

    beforeEach(async () => {
      dir = await createTempDir('labelflash-batch-');
    });

    afterEach(async () => {
      await removeTempDir(dir);
    });

    test('reads the file at the path with its name', async () => {
      const { station } = createStation({
        readTable: async (request) => ({ ok: true, records: [['种类'], [request.kind]] }),
      });
      const path = join(dir, '货号.xlsx');
      await writeFile(path, minimalXlsx([['a']]));
      expect(await station.loadPath(path)).toMatchObject({
        status: 'loaded',
        table: { name: '货号.xlsx', rows: [['xlsx']] },
      });
    });
  });
});

describe('BatchStation printing', () => {
  test('prints every label in order with its batch, row and copy', async () => {
    const { station, printed } = createStation();
    const tableId = await loaded(station);
    expect(station.start(planFor(tableId))).toMatchObject({
      status: 'started',
      batch: { batchId: BATCH_ID, total: 2 },
    });
    await station.whenIdle();
    expect(printed.map((input) => [input.source, input.batch, input.content])).toEqual([
      ['batch', { id: BATCH_ID, row: 1, copy: 1 }, '编码：CL1\n颜色：红'],
      ['batch', { id: BATCH_ID, row: 2, copy: 1 }, '编码：BAD'],
    ]);
    expect(station.status()).toMatchObject({ state: 'done', sent: 2, templateName: CANVAS_TAG.name });
  });

  test('refuses to start a second batch, an unknown table or a deleted template', async () => {
    const { station } = createStation({ printFields: () => new Promise(() => undefined) });
    const tableId = await loaded(station);
    expect(station.start(planFor('00000000-0000-4000-8000-000000000009'))).toEqual({
      status: 'invalid',
      issue: '表格已经换过了：请重新导入',
    });
    expect(station.start({ ...planFor(tableId), templateId: 'custom:gone' })).toEqual({
      status: 'invalid',
      issue: '模板已经不在了：请重新选择模板',
    });
    expect(station.start(planFor(tableId)).status).toBe('started');
    expect(station.start(planFor(tableId))).toEqual({
      status: 'invalid',
      issue: '上一批还没打完：等它打完，或者先取消',
    });
    expect(station.pendingLabels).toBe(2);
  });

  // 表格重新导入过、或对列设置没跟着改：对着一张不存在的列展开，每一行都会报同一个问题，不如一次说清楚。
  test('refuses to start when a mapped, copies or serial column is missing from the table', async () => {
    const { station } = createStation();
    const tableId = await loaded(station);
    const badMapping = planFor(tableId, {
      mapping: { 编码: { kind: 'column', column: '编码' }, 颜色: { kind: 'column', column: '货架号' } },
    });
    expect(station.start(badMapping)).toEqual({
      status: 'invalid',
      issue: '对的列已经不在表里，需要重新对列：货架号',
    });
    const badCopies = planFor(tableId, { copies: { kind: 'column', column: '份数' } });
    expect(station.start(badCopies)).toEqual({
      status: 'invalid',
      issue: '对的列已经不在表里，需要重新对列：份数',
    });
    const badSerial = planFor(tableId, { serial: { ...DEFAULT_SERIAL, enabled: true, column: '货架号' } });
    expect(station.start(badSerial)).toEqual({
      status: 'invalid',
      issue: '对的列已经不在表里，需要重新对列：货架号',
    });
  });

  // 每张都推会让界面一直重排；状态变化（开始、暂停、打完）立即推。
  test('sends state changes at once and merges progress', async () => {
    const { station, statuses, scheduled } = createStation();
    const tableId = await loaded(station);
    station.start(planFor(tableId));
    await station.whenIdle();
    expect(statuses.map((status) => status?.state)).toEqual(['running', 'done']);
    expect(scheduled).toEqual([]);
  });

  test('retries the failed labels of a batch with their stored fields', async () => {
    const failed: JobRecord = {
      id: 'j1',
      createdAt: 1,
      raw: '编码：CL7',
      printerName: 'P',
      source: 'batch',
      status: 'failed',
      forced: false,
      failureReason: 'PRINT_ERROR',
      templateId: CANVAS_TAG.id,
      fields: [{ name: '编码', value: 'CL7' }],
      batch: { id: BATCH_ID, row: 7, copy: 2 },
    };
    const { station, printed } = createStation({
      failedJobs: (batchId, row) => (batchId === BATCH_ID && row === null ? [failed] : []),
    });
    expect(station.retryFailed(BATCH_ID, null).status).toBe('started');
    await station.whenIdle();
    expect(printed.map((input) => [input.batch, input.content, input.fields])).toEqual([
      [{ id: BATCH_ID, row: 7, copy: 2 }, '编码：CL7', [{ name: '编码', value: 'CL7' }]],
    ]);
    expect(station.retryFailed(BATCH_ID, 3)).toEqual({ status: 'invalid', issue: '这一批没有要重打的失败标签' });
  });
});

describe('BatchStation preview and check', () => {
  test('previews one row as it will print', async () => {
    const { station } = createStation();
    const tableId = await loaded(station);
    const serial = { ...DEFAULT_SERIAL, enabled: true, digits: 2 };
    expect(await station.preview(planFor(tableId, { serial }), 1)).toMatchObject({
      status: 'ok',
      preview: { html: '<p>编码：BAD\n序号：02</p>' },
    });
  });

  test('lists the rows whose label cannot be printed in full', async () => {
    const { station } = createStation();
    const tableId = await loaded(station);
    expect(await station.check(planFor(tableId))).toEqual({
      problems: [{ row: 2, texts: ['条码「商品码」不印：位数不对'] }],
    });
  });

  test('gives up an older check when a newer one starts', async () => {
    const { station } = createStation();
    const tableId = await loaded(station);
    const older = station.check(planFor(tableId));
    const newer = station.check(planFor(tableId));
    expect(await older).toBeNull();
    expect(await newer).not.toBeNull();
  });
});
