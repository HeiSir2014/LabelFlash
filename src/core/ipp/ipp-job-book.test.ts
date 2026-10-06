import { describe, expect, test } from 'bun:test';
import { FakeClock } from '../testing/fake-clock';
import { findAttribute, integerValue, stringValue } from './ipp-attributes';
import { VALUE_TAGS } from './ipp-constants';
import { HELD_REASON, IPP_JOB_LIMITS, IppJobBook, jobAttributes, jobIdFromUri, type NewIppJob } from './ipp-job-book';

const NEW_JOB: NewIppJob = {
  printerKey: '60x40',
  name: '面单',
  user: 'zhang',
  client: '192.168.1.23',
  sizeBytes: 3000,
  held: false,
};

function created(book: IppJobBook, overrides: Partial<NewIppJob> = {}) {
  const result = book.create({ ...NEW_JOB, ...overrides });
  if (result.status !== 'created') {
    throw new Error(`not created: ${result.status}`);
  }
  return result.job;
}

describe('IppJobBook', () => {
  test('creates pending or held jobs with increasing ids', () => {
    const book = new IppJobBook(new FakeClock());
    expect(created(book)).toMatchObject({ id: 1, state: 'pending', reasons: ['none'] });
    expect(created(book, { held: true, client: '192.168.1.24' })).toMatchObject({
      id: 2,
      state: 'pending-held',
      reasons: [HELD_REASON],
    });
  });

  test('refuses new jobs when too many are open, in total and per computer', () => {
    const book = new IppJobBook(new FakeClock());
    created(book);
    created(book);
    expect(book.create(NEW_JOB).status).toBe('client-busy');
    created(book, { client: '192.168.1.24' });
    created(book, { client: '192.168.1.25' });
    expect(book.create({ ...NEW_JOB, client: '192.168.1.26' }).status).toBe('busy');
    expect(book.activeCount()).toBe(IPP_JOB_LIMITS.active);
  });

  // 没被允许的电脑占不满任务名额：等确认的单独算，每台 1 个、一共 2 个，文档加起来也有上限。
  test('keeps held jobs apart from the active limit and caps them separately', () => {
    const book = new IppJobBook(new FakeClock());
    created(book, { held: true, client: '192.168.1.31' });
    expect(book.create({ ...NEW_JOB, held: true, client: '192.168.1.31' }).status).toBe('client-busy');
    created(book, { held: true, client: '192.168.1.32' });
    expect(book.create({ ...NEW_JOB, held: true, client: '192.168.1.33' }).status).toBe('busy');
    for (const client of ['192.168.1.1', '192.168.1.2', '192.168.1.3', '192.168.1.4']) {
      created(book, { client });
    }
    expect(book.activeCount()).toBe(IPP_JOB_LIMITS.active);
    expect(book.heldCount()).toBe(IPP_JOB_LIMITS.held);
  });

  test('caps the bytes of held documents in total', () => {
    const book = new IppJobBook(new FakeClock());
    created(book, { held: true, client: '192.168.1.31', sizeBytes: IPP_JOB_LIMITS.heldBytes - 10 });
    expect(book.create({ ...NEW_JOB, held: true, client: '192.168.1.32', sizeBytes: 11 }).status).toBe('busy');
    expect(book.create({ ...NEW_JOB, held: true, client: '192.168.1.32', sizeBytes: 10 }).status).toBe('created');
  });

  test('moves a job from held to completed', () => {
    const clock = new FakeClock();
    const book = new IppJobBook(clock);
    const job = created(book, { held: true });
    expect(book.start(job.id)).toBe(false);
    book.release(job.id);
    clock.advance(1_000);
    expect(book.start(job.id)).toBe(true);
    book.progress(job.id, 2);
    book.finish(job.id, 'completed', ['job-completed-successfully'], '已发送到打印机');
    expect(book.get(job.id)).toMatchObject({ state: 'completed', impressions: 2, processingAt: job.createdAt + 1_000 });
    expect(book.activeCount()).toBe(0);
  });

  test('cancels waiting jobs at once and asks running ones to stop', () => {
    const book = new IppJobBook(new FakeClock());
    const waiting = created(book);
    const running = created(book, { client: '192.168.1.24' });
    book.start(running.id);
    expect(book.cancel(waiting.id, '192.168.1.99')).toBe('not-owner');
    expect(book.cancel(waiting.id, NEW_JOB.client)).toBe('canceled');
    expect(book.get(waiting.id)?.state).toBe('canceled');
    expect(book.cancel(running.id, '192.168.1.24')).toBe('requested');
    expect(book.get(running.id)).toMatchObject({ state: 'processing', cancelRequested: true });
    expect(book.cancel(waiting.id, NEW_JOB.client)).toBe('finished');
    expect(book.cancel(99, NEW_JOB.client)).toBe('not-found');
  });

  test('lists open jobs oldest first and finished jobs newest first', () => {
    const clock = new FakeClock();
    const book = new IppJobBook(clock);
    const first = created(book);
    const second = created(book, { client: '192.168.1.24' });
    created(book, { printerKey: '100x150', client: '192.168.1.25' });
    expect(book.list('60x40', 'not-completed', null).map((job) => job.id)).toEqual([first.id, second.id]);
    book.finish(first.id, 'completed', ['job-completed-successfully'], '');
    clock.advance(1);
    book.finish(second.id, 'aborted', ['aborted-by-system'], '');
    expect(book.list('60x40', 'completed', null).map((job) => job.id)).toEqual([second.id, first.id]);
    expect(book.list('60x40', 'completed', 1).map((job) => job.id)).toEqual([second.id]);
  });

  test('forgets finished jobs after an hour', () => {
    const clock = new FakeClock();
    const book = new IppJobBook(clock);
    const job = created(book);
    book.finish(job.id, 'completed', [], '');
    clock.advance(IPP_JOB_LIMITS.finishedMs + 1);
    created(book, { client: '192.168.1.24' });
    expect(book.get(job.id)).toBeNull();
  });

  test('keeps at most 100 finished jobs', () => {
    const clock = new FakeClock();
    const book = new IppJobBook(clock);
    const first = created(book);
    book.finish(first.id, 'completed', [], '');
    for (let index = 0; index < IPP_JOB_LIMITS.finished; index += 1) {
      clock.advance(1);
      const job = created(book);
      book.finish(job.id, 'completed', [], '');
    }
    created(book);
    expect(book.get(first.id)).toBeNull();
    expect(book.list('60x40', 'completed', null)).toHaveLength(IPP_JOB_LIMITS.finished);
  });

  test('aborts every open job when sharing stops', () => {
    const book = new IppJobBook(new FakeClock());
    const waiting = created(book);
    const running = created(book, { client: '192.168.1.24' });
    book.start(running.id);
    book.abortAll('共享已关闭');
    expect(book.get(waiting.id)).toMatchObject({ state: 'aborted', message: '共享已关闭' });
    expect(book.get(running.id)).toMatchObject({ state: 'processing', cancelRequested: true });
  });

  test('hands out copies that callers cannot change', () => {
    const book = new IppJobBook(new FakeClock());
    const job = created(book);
    job.state = 'completed';
    expect(book.get(job.id)?.state).toBe('pending');
  });
});

describe('jobAttributes', () => {
  test('describes a job with times counted from when sharing started', () => {
    const clock = new FakeClock();
    const book = new IppJobBook(clock);
    const startedAt = clock.now();
    clock.advance(5_000);
    const job = created(book);
    const attributes = jobAttributes(job, {
      printerUri: 'ipp://192.168.1.10:8631/printers/60x40',
      startedAt,
      nowMs: startedAt + 7_000,
    });
    expect(integerValue(findAttribute(attributes, 'job-id'))).toBe(1);
    expect(stringValue(findAttribute(attributes, 'job-uri'))).toBe('ipp://192.168.1.10:8631/printers/60x40/jobs/1');
    expect(integerValue(findAttribute(attributes, 'job-state'))).toBe(3);
    expect(integerValue(findAttribute(attributes, 'time-at-creation'))).toBe(5);
    expect(integerValue(findAttribute(attributes, 'job-printer-up-time'))).toBe(7);
    expect(findAttribute(attributes, 'time-at-processing')?.values).toEqual([
      { kind: 'out-of-band', tag: VALUE_TAGS.noValue },
    ]);
  });
});

describe('jobIdFromUri', () => {
  test('reads the id at the end of a job URI', () => {
    expect(jobIdFromUri('ipp://h:8631/printers/60x40/jobs/12')).toBe(12);
    expect(jobIdFromUri('ipp://h:8631/printers/60x40')).toBeNull();
    expect(jobIdFromUri('ipp://h:8631/printers/60x40/jobs/9999999999')).toBeNull();
    expect(jobIdFromUri(null)).toBeNull();
  });
});
