import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BATCH_LIMITS,
  type BatchPlan,
  DEFAULT_COPIES,
  DEFAULT_SERIAL,
  FILE_TOO_LARGE_ISSUE,
} from '../../core/batch/batch-model';
import type { FieldsPrint } from '../../core/print-service';
import { CANVAS_TAG } from '../../core/templates/builtin-canvas';
import type { JobRecord, PrintResult } from '../../core/types';
import type { BatchStatus } from '../../shared/batch';
import { DEFAULT_PAPER } from '../../shared/label-paper';
import { NO_RENDER_WARNINGS } from '../../shared/render-warnings';
import { createTempDir, removeTempDir } from '../storage/testing/temp-dir';
import { BatchStation, type BatchStationDeps } from './batch-station';
import type { TableReadReply } from './table-file';
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
  let jobsChangedCount = 0;
  let clockMs = 0;
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
    onJobsChanged: () => {
      jobsChangedCount += 1;
    },
    now: () => clockMs,
    ...overrides,
  };
  return {
    station: new BatchStation(deps),
    printed,
    statuses,
    scheduled,
    jobsChangedCount: () => jobsChangedCount,
    advanceClock: (ms: number) => {
      clockMs += ms;
    },
  };
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

  test('refuses a file over the size limit before starting a reader', async () => {
    let reads = 0;
    const { station } = createStation({
      readTable: async () => {
        reads += 1;
        return { ok: true, records: [] };
      },
    });
    expect(await station.loadBytes('huge.csv', new Uint8Array(BATCH_LIMITS.fileBytes + 1))).toEqual({
      status: 'invalid',
      issue: FILE_TOO_LARGE_ISSUE,
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

  // 读表格要去子进程跑一趟，比较慢：这次导入还没读完的时候，又粘贴了一张表（马上就有结果）。
  // 慢的那次读完之后不能用旧结果覆盖已经更新过的表。
  test('drops a slow file-read result that is superseded by a faster paste', async () => {
    const held: { resolve: ((reply: TableReadReply) => void) | null } = { resolve: null };
    const { station } = createStation({
      readTable: () =>
        new Promise<TableReadReply>((resolve) => {
          held.resolve = resolve;
        }),
    });
    const slowLoad = station.loadBytes('slow.xlsx', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0]));
    const pasted = station.paste('编码\nFROM_PASTE\n');
    if (pasted.status !== 'loaded') {
      throw new Error('expected the paste to load');
    }
    held.resolve?.({ ok: true, records: [['编码'], ['FROM_XLSX']] });
    expect(await slowLoad).toEqual({ status: 'canceled' });
    // 粘贴的那张表还在：用它的编号开一批能找到表，没有被慢一步回来的 xlsx 结果覆盖掉。
    const mapping = { 编码: { kind: 'column', column: '编码' }, 颜色: { kind: 'none' } } as const;
    expect(station.start(planFor(pasted.table.id, { mapping })).status).toBe('started');
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

  // 退出确认要用到：正在打的那一张不算「没打」（已经交给打印机），只有排在它后面、还没轮到的才算。
  test('reports the labels not yet handed to the printer, excluding the one in flight', async () => {
    const { station } = createStation({ printFields: () => new Promise(() => undefined) });
    expect(station.pendingQuit()).toBeNull();
    const tableId = await loaded(station);
    station.start(planFor(tableId));
    const pending = station.pendingQuit();
    expect(pending?.batchId).toBe(BATCH_ID);
    expect(pending?.labels).toEqual([{ row: 2, copy: 1, fields: expect.any(Array), content: '编码：BAD' }]);
  });

  test('has nothing pending once the batch is done', async () => {
    const { station } = createStation();
    const tableId = await loaded(station);
    station.start(planFor(tableId));
    await station.whenIdle();
    expect(station.pendingQuit()).toBeNull();
  });

  // 退出确认不是用来追着操作员要答案的：批次被操作员自己取消之后，剩下没打的是他自己的决定，
  // 不该在之后随便一次退出（哪怕是打印机列表加载完之类完全无关的时机）又弹一次确认。
  test('has nothing pending once the batch is canceled, even with labels left unattempted', async () => {
    const held: { resolve: ((result: PrintResult) => void) | null } = { resolve: null };
    const { station } = createStation({
      printFields: () => new Promise((resolve) => (held.resolve = resolve)),
    });
    const tableId = await loaded(station);
    station.start(planFor(tableId));
    station.cancel();
    held.resolve?.(PRINTED);
    await station.whenIdle();
    expect(station.pendingQuit()).toBeNull();
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

  // 序号关着时，序号列指向哪里都不该报错；模板（CANVAS_TAG）只用到编码、颜色，mapping 里残留一个
  // 模板不认的变量（例如换模板之前对过列）指向一个不存在的列，也不该报错——那一项反正不会被用到。
  test('ignores a stale serial column while serial is disabled, and a mapping entry for an unused variable', async () => {
    const { station } = createStation();
    const tableId = await loaded(station);
    const serialDisabled = planFor(tableId, {
      serial: { ...DEFAULT_SERIAL, enabled: false, column: '货架号' },
    });
    expect(station.start(serialDisabled).status).toBe('started');
    await station.whenIdle();

    const staleVariable = planFor(tableId, {
      mapping: {
        编码: { kind: 'column', column: '编码' },
        颜色: { kind: 'column', column: '颜色' },
        旧字段: { kind: 'column', column: '货架号' },
      },
    });
    expect(station.start(staleVariable).status).toBe('started');
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

  // 一批最多 2 万张，但保留的打印记录条数可能比它小（例如调小过容量）：这一批还在这次会话里时，
  // 重打失败的要用内存里完整的名单，不能依赖可能已经被裁剪掉的打印记录。
  test('retries failures of the batch still in memory without querying the trimmed job history', async () => {
    const printed: FieldsPrint[] = [];
    const { station } = createStation({
      printFields: async (input) => {
        printed.push(input);
        return input.content.includes('BAD') ? { status: 'failed', reason: 'PRINT_ERROR' } : PRINTED;
      },
      failedJobs: () => {
        throw new Error('must not query job history for a batch still in this session');
      },
    });
    const tableId = await loaded(station);
    const started = station.start(planFor(tableId));
    if (started.status !== 'started') {
      throw new Error('expected the batch to start');
    }
    await station.whenIdle();
    printed.length = 0;
    expect(station.retryFailed(started.batch.batchId, null).status).toBe('started');
    await station.whenIdle();
    expect(printed.map((input) => input.content)).toEqual(['编码：BAD']);
  });

  // 行 2、3 第一次都失败；只重打行 2（成功了）之后，「整批重打失败的」还得找到行 3——
  // 不能因为上一次重打只带了行 2 那一张标签（新的 BatchRun 只认识这一张），就把行 3 的失败忘掉。
  test("keeps a batch's open failures merged across separate retries", async () => {
    const attempts = new Map<string, number>();
    const { station } = createStation({
      readTable: async () => ({ ok: true, records: [['编码'], ['R1'], ['R2'], ['R3']] }),
      printFields: async (input) => {
        const count = (attempts.get(input.content) ?? 0) + 1;
        attempts.set(input.content, count);
        return count === 1 && input.content !== '编码：R1' ? { status: 'failed', reason: 'PRINT_ERROR' } : PRINTED;
      },
    });
    const tableId = await loaded(station);
    const mapping = { 编码: { kind: 'column', column: '编码' }, 颜色: { kind: 'none' } } as const;
    const started = station.start(planFor(tableId, { mapping }));
    if (started.status !== 'started') {
      throw new Error('expected the batch to start');
    }
    const batchId = started.batch.batchId;
    await station.whenIdle();
    expect(station.status()).toMatchObject({ state: 'done', sent: 1, failed: 2 });

    expect(station.retryFailed(batchId, 2).status).toBe('started');
    await station.whenIdle();
    // 行 2 这次成功了，但行 3 还是失败的——这次重打没碰过它，它不该消失。
    expect(station.status()).toMatchObject({ state: 'done', sent: 1, failed: 1 });

    expect(station.retryFailed(batchId, null).status).toBe('started');
    await station.whenIdle();
    expect(station.status()).toMatchObject({ state: 'done', sent: 1, failed: 0 });
  });

  test('refuses to retry from memory once its template has been deleted', async () => {
    let templateDeleted = false;
    const { station } = createStation({
      printFields: async () => ({ status: 'failed', reason: 'PRINT_ERROR' }),
      findTemplate: (id) => (!templateDeleted && id === CANVAS_TAG.id ? CANVAS_TAG : null),
    });
    const tableId = await loaded(station);
    const started = station.start(planFor(tableId));
    if (started.status !== 'started') {
      throw new Error('expected the batch to start');
    }
    await station.whenIdle();
    templateDeleted = true;
    expect(station.retryFailed(started.batch.batchId, null)).toEqual({
      status: 'invalid',
      issue: '这一批用的模板已经删掉了，不能按原样重打',
    });
  });

  // 内存里还留着这一批（跟着的那次 schedule 没触发真正的计时器，只是把回调存起来）：
  // 状态条每一次合并推送都更新，但打印记录的刷新通知更贵，状态没变时最快一秒推一次，状态变了总是立即推。
  test('throttles JobsChanged to at most once per second, but not on a state change', async () => {
    const printed: FieldsPrint[] = [];
    const pending: ((result: PrintResult) => void)[] = [];
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const { station, scheduled, jobsChangedCount, advanceClock } = createStation({
      readTable: async () => ({ ok: true, records: [['编码'], ['R1'], ['R2'], ['R3']] }),
      printFields: (input) =>
        new Promise((resolve) => {
          printed.push(input);
          pending.push(resolve);
        }),
    });
    const release = async (result: PrintResult = PRINTED) => {
      pending.shift()?.(result);
      await settle();
    };
    const tableId = await loaded(station);
    const mapping = { 编码: { kind: 'column', column: '编码' }, 颜色: { kind: 'none' } } as const;
    station.start(planFor(tableId, { mapping }));
    await settle();
    expect(jobsChangedCount()).toBe(1); // 开始：状态变化，立即推一次。

    await release(); // 行 1 打完，还是 running：排了一次合并推送，没真的推。
    expect(scheduled.length).toBe(1);
    scheduled.shift()?.();
    expect(jobsChangedCount()).toBe(1); // 时钟没走，节流住了。

    await release(); // 行 2 打完，同样是 running。
    scheduled.shift()?.();
    expect(jobsChangedCount()).toBe(1); // 还没到一秒。

    advanceClock(1_000);
    await release(); // 行 3 打完：这一批也结束了（running → done），状态变化立即推。
    expect(jobsChangedCount()).toBe(2);
    expect(printed.map((input) => input.content)).toEqual(['编码：R1', '编码：R2', '编码：R3']);
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

  // 模板、表格对不上时，不能悄悄说「没有问题」：界面要能看到到底是哪里不对。
  test('reports the issue instead of silently saying there are no problems when the plan cannot be prepared', async () => {
    const { station } = createStation();
    const tableId = await loaded(station);
    expect(await station.check({ ...planFor(tableId), templateId: 'custom:gone' })).toEqual({
      problems: [],
      issue: '模板已经不在了：请重新选择模板',
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
