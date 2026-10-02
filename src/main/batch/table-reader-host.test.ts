import { describe, expect, test } from 'bun:test';
import { BATCH_LIMITS } from '../../core/batch/batch-model';
import type { TableReadRequest } from './table-file';
import {
  READ_TIMEOUT_ISSUE,
  READER_FAILED_ISSUE,
  type ReaderProcess,
  readReply,
  TableReaderHost,
} from './table-reader-host';

const REQUEST: TableReadRequest = { kind: 'csv', bytes: new Uint8Array([0x61]) };
const TIMEOUT_MS = 30_000;

class FakeProcess implements ReaderProcess {
  readonly posted: TableReadRequest[] = [];
  killed = false;
  private messageListener: ((message: unknown) => void) | null = null;
  private exitListener: ((code: number) => void) | null = null;

  postMessage(request: TableReadRequest): void {
    this.posted.push(request);
  }

  onMessage(listener: (message: unknown) => void): void {
    this.messageListener = listener;
  }

  onExit(listener: (code: number) => void): void {
    this.exitListener = listener;
  }

  kill(): void {
    this.killed = true;
  }

  reply(message: unknown): void {
    this.messageListener?.(message);
  }

  exit(code: number): void {
    this.exitListener?.(code);
  }
}

function createHost() {
  const child = new FakeProcess();
  const timers: (() => void)[] = [];
  const logs: string[] = [];
  const host = new TableReaderHost({
    fork: () => child,
    timeoutMs: TIMEOUT_MS,
    schedule: (run) => {
      timers.push(run);
      return () => {
        timers.splice(timers.indexOf(run), 1);
      };
    },
    log: (line) => logs.push(line),
  });
  return { host, child, timers, logs };
}

describe('TableReaderHost', () => {
  test('hands the bytes to a new process, returns its rows and ends the process', async () => {
    const { host, child, timers } = createHost();
    const reading = host.read(REQUEST);
    expect(child.posted).toEqual([REQUEST]);
    child.reply({ ok: true, records: [['编码'], ['CL1']] });
    expect(await reading).toEqual({ ok: true, records: [['编码'], ['CL1']] });
    expect(child.killed).toBe(true);
    expect(timers).toEqual([]);
  });

  test('kills a process that does not answer in time', async () => {
    const { host, child, timers, logs } = createHost();
    const reading = host.read(REQUEST);
    timers[0]?.();
    expect(await reading).toEqual({ ok: false, issue: READ_TIMEOUT_ISSUE });
    expect(child.killed).toBe(true);
    expect(logs.join('\n')).toContain('timed out');
  });

  // 堆超了 512MB 时 V8 直接结束子进程：不会有回复，只有退出。
  test('reports a process that died without answering', async () => {
    const { host, child, logs } = createHost();
    const reading = host.read(REQUEST);
    child.exit(134);
    expect(await reading).toEqual({ ok: false, issue: READER_FAILED_ISSUE });
    expect(logs.join('\n')).toContain('exited with code 134');
  });

  test('passes on the reason a file was refused and logs the library error', async () => {
    const { host, child, logs } = createHost();
    const reading = host.read(REQUEST);
    child.reply({ ok: false, issue: '读不出这个文件', detail: 'bad zip' });
    expect(await reading).toEqual({ ok: false, issue: '读不出这个文件' });
    expect(logs.join('\n')).toContain('bad zip');
  });
});

describe('readReply', () => {
  test('refuses replies with the wrong shape or beyond the limits', () => {
    expect(readReply({ ok: true, records: [[1]] }).ok).toBe(false);
    expect(readReply({ ok: true, records: 'x' }).ok).toBe(false);
    expect(readReply({ ok: true, records: [Array(BATCH_LIMITS.columns + 1).fill('')] }).ok).toBe(false);
    expect(readReply('x').ok).toBe(false);
    expect(readReply({ ok: false, issue: 'x'.repeat(1_000) })).toMatchObject({ ok: false });
  });
});
