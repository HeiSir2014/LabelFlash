import { describe, expect, test } from 'bun:test';
import type { FieldsPrint } from '../print-service';
import { STANDARD_TEMPLATE } from '../templates/builtin-templates';
import { FakeClock } from '../testing/fake-clock';
import { InMemoryApiJobStore } from '../testing/in-memory-api-job-store';
import type { PrintResult } from '../types';
import type { PrintJobInput } from './api-model';
import { JOB_RETENTION_MS, PrintJobService, REQUEST_ID_WINDOW_MS } from './print-job-service';

const INPUT: PrintJobInput = {
  templateId: STANDARD_TEMPLATE.id,
  fields: [{ name: '订单号', value: 'A001' }],
  content: null,
  copies: 1,
  printer: null,
  requestId: null,
};
const REQUEST_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const SENT: PrintResult = {
  status: 'printed',
  jobId: 'r',
  scan: { raw: 'x', ruleId: 'api', ruleName: '本机接口', fields: [] },
};
const QUEUE_LIMIT = 10;

type Printer = (input: FieldsPrint) => Promise<PrintResult>;

function createHarness(results: PrintResult[] = []) {
  const clock = new FakeClock();
  const store = new InMemoryApiJobStore();
  const printed: FieldsPrint[] = [];
  let printer: Printer = async () => results.shift() ?? SENT;
  let nextId = 0;
  const service = new PrintJobService({
    store,
    clock,
    createId: () => `pj-${++nextId}`,
    findTemplate: (id) => (id === STANDARD_TEMPLATE.id ? STANDARD_TEMPLATE : null),
    installedPrinters: async () => ['标签机A'],
    printFields: (input) => {
      printed.push(input);
      return printer(input);
    },
    queueLimit: QUEUE_LIMIT,
  });
  const usePrinter = (next: Printer) => {
    printer = next;
  };
  return { clock, store, printed, service, usePrinter };
}

describe('PrintJobService', () => {
  test('queues a job, prints each copy and ends SENT', async () => {
    const { service, printed } = createHarness();
    const job = await service.create('key:k1', { ...INPUT, copies: 2 });
    expect(job).toMatchObject({ state: 'QUEUED', sentCopies: 0, caller: 'key:k1' });
    await service.idle();
    expect(service.get(job.id)).toMatchObject({ state: 'SENT', sentCopies: 2, failure: null });
    expect(printed.map((item) => item.content)).toEqual(['订单号：A001', '订单号：A001']);
    expect(printed[0]).toMatchObject({
      source: 'api',
      caller: 'key:k1',
      printerName: null,
      template: STANDARD_TEMPLATE,
    });
  });

  test('prints on the printer the caller named', async () => {
    const { service, printed } = createHarness();
    await service.create('key:k1', { ...INPUT, printer: '标签机A' });
    await service.idle();
    expect(printed[0]?.printerName).toBe('标签机A');
  });

  // 服装标签要按提交的顺序连续出纸：任务排成一队，一个打完（所有份数）再打下一个。
  test('prints jobs one after another in the order they were submitted', async () => {
    const { service, printed, usePrinter } = createHarness();
    let release: () => void = () => {};
    usePrinter(
      () =>
        new Promise((resolve) => {
          release = () => resolve(SENT);
        }),
    );
    const [first, second] = await service.createBatch('key:k1', [
      { ...INPUT, copies: 2, content: 'first' },
      { ...INPUT, content: 'second' },
    ]);
    await Promise.resolve();
    expect(service.get(first?.id ?? '')?.state).toBe('PRINTING');
    expect(service.get(second?.id ?? '')?.state).toBe('QUEUED');
    usePrinter(async () => SENT);
    release();
    await service.idle();
    expect(printed.map((item) => item.content)).toEqual(['first', 'first', 'second']);
  });

  test('stops at the first failed copy and says why', async () => {
    const { service, printed } = createHarness([
      SENT,
      { status: 'no-printer', paperKey: '60x40', missingPrinter: null },
    ]);
    const job = await service.create('key:k1', { ...INPUT, copies: 3 });
    await service.idle();
    expect(service.get(job.id)).toMatchObject({ state: 'FAILED', sentCopies: 1, failure: { reason: 'NO_PRINTER' } });
    expect(printed).toHaveLength(2);
  });

  test('passes on the driver failure and its detail', async () => {
    const { service } = createHarness([{ status: 'failed', reason: 'PRINTER_NOT_READY', detail: '缺纸' }]);
    const job = await service.create('key:k1', INPUT);
    await service.idle();
    expect(service.get(job.id)?.failure).toEqual({ reason: 'PRINTER_NOT_READY', message: '缺纸' });
  });

  test('a failed job does not stop the next one', async () => {
    const { service } = createHarness([{ status: 'failed', reason: 'PRINT_ERROR' }]);
    const [failed, next] = await service.createBatch('key:k1', [INPUT, INPUT]);
    await service.idle();
    expect(service.get(failed?.id ?? '')?.state).toBe('FAILED');
    expect(service.get(next?.id ?? '')?.state).toBe('SENT');
  });

  test('fails the job instead of leaving it printing when printing throws', async () => {
    const { service, usePrinter } = createHarness();
    usePrinter(async () => {
      throw new Error('boom');
    });
    const job = await service.create('key:k1', INPUT);
    await service.idle();
    expect(service.get(job.id)).toMatchObject({ state: 'FAILED', failure: { reason: 'PRINT_ERROR' } });
  });

  // AIP-155：同一调用方、同一 requestId 在 24 小时内重复提交，返回已有的任务，不再打印。
  test('returns the existing job for a repeated requestId from the same caller', async () => {
    const { service, printed, clock } = createHarness();
    const first = await service.create('key:k1', { ...INPUT, requestId: REQUEST_ID });
    const again = await service.create('key:k1', { ...INPUT, requestId: REQUEST_ID });
    const other = await service.create('key:k2', { ...INPUT, requestId: REQUEST_ID });
    await service.idle();
    expect(again.id).toBe(first.id);
    expect(other.id).not.toBe(first.id);
    expect(printed).toHaveLength(2);
    clock.advance(REQUEST_ID_WINDOW_MS);
    expect((await service.create('key:k1', { ...INPUT, requestId: REQUEST_ID })).id).not.toBe(first.id);
  });

  test('creates one job for a requestId repeated inside a batch', async () => {
    const { service } = createHarness();
    const [first, second] = await service.createBatch('key:k1', [
      { ...INPUT, requestId: REQUEST_ID },
      { ...INPUT, requestId: REQUEST_ID },
    ]);
    expect(second?.id).toBe(first?.id ?? '');
  });

  test('rejects an unknown template or printer before queueing anything', async () => {
    const { service, store } = createHarness();
    await expect(service.create('key:k1', { ...INPUT, templateId: 'custom:gone' })).rejects.toMatchObject({
      code: 'TEMPLATE_NOT_FOUND',
      index: 0,
    });
    await expect(service.create('key:k1', { ...INPUT, printer: '没有这台' })).rejects.toMatchObject({
      code: 'PRINTER_NOT_FOUND',
    });
    expect(store.all()).toEqual([]);
  });

  // 一批要么全收、要么全不收（AIP-233）：模板、打印机、排队上限都先核对整批。
  test('accepts a batch only as a whole', async () => {
    const { service, store } = createHarness();
    await expect(service.createBatch('key:k1', [INPUT, { ...INPUT, templateId: 'custom:gone' }])).rejects.toMatchObject(
      { code: 'TEMPLATE_NOT_FOUND', index: 1 },
    );
    expect(store.all()).toEqual([]);
    expect(await service.createBatch('key:k1', [INPUT, INPUT])).toHaveLength(2);
  });

  test('refuses more labels than the queue limit, counting labels still waiting', async () => {
    const { service, usePrinter } = createHarness();
    await expect(service.create('key:k1', { ...INPUT, copies: QUEUE_LIMIT + 1 })).rejects.toMatchObject({
      code: 'QUEUE_FULL',
    });
    usePrinter(() => new Promise(() => {}));
    await service.create('key:k1', { ...INPUT, copies: QUEUE_LIMIT });
    await expect(service.create('key:k1', INPUT)).rejects.toMatchObject({ code: 'QUEUE_FULL' });
  });

  test('forgets finished jobs after the retention period', async () => {
    const { service, clock } = createHarness();
    const job = await service.create('key:k1', INPUT);
    await service.idle();
    clock.advance(JOB_RETENTION_MS - 1);
    service.purge();
    expect(service.get(job.id)).not.toBeNull();
    clock.advance(1);
    service.purge();
    expect(service.get(job.id)).toBeNull();
  });

  // 程序在打完之前退出：重启后不自动续打（免得一启动突然出纸），标成失败，已发送的份数照实写。
  test('marks jobs left unfinished by a restart as interrupted', () => {
    const { service, store } = createHarness();
    store.insert({
      ...INPUT,
      copies: 3,
      id: 'old',
      caller: 'key:k1',
      state: 'PRINTING',
      sentCopies: 1,
      failure: null,
      createdAt: 0,
      updatedAt: 0,
    });
    service.recoverInterrupted();
    expect(service.get('old')).toMatchObject({ state: 'FAILED', sentCopies: 1, failure: { reason: 'INTERRUPTED' } });
  });
});
