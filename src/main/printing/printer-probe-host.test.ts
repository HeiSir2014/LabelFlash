import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { PrinterProbeHost, type ProbeProcess } from './printer-probe-host';

const TIMEOUT_MS = 50;

/** 模拟常驻的 PowerShell：测试读它收到的请求行，再手动写回答行。 */
class FakeProbe extends EventEmitter implements ProbeProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly requests: string[] = [];
  isKilled = false;

  constructor() {
    super();
    createInterface({ input: this.stdin }).on('line', (line) => this.requests.push(line));
  }

  reply(line: string): void {
    this.stdout.write(`${line}\n`);
  }

  kill(): boolean {
    this.isKilled = true;
    this.emit('exit', null);
    return true;
  }
}

function harness() {
  const spawned: FakeProbe[] = [];
  const warnings: string[] = [];
  const host = new PrinterProbeHost(
    () => {
      const probe = new FakeProbe();
      spawned.push(probe);
      return probe;
    },
    TIMEOUT_MS,
    (message) => warnings.push(message),
  );
  return { host, spawned, warnings };
}

/** 等请求行到达假进程（写入 stdin 是异步的）。 */
async function nextRequests(probe: FakeProbe, count: number): Promise<string[]> {
  while (probe.requests.length < count) {
    await Bun.sleep(1);
  }
  return probe.requests.slice(0, count);
}

const base64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

describe('PrinterProbeHost', () => {
  test('sends the printer name as base64 data and returns the answer', async () => {
    const { host, spawned } = harness();
    const answer = host.query('status', '热敏标签机 *1');
    const probe = spawned[0] as FakeProbe;
    expect(await nextRequests(probe, 1)).toEqual([`status ${base64('热敏标签机 *1')}`]);
    probe.reply('ok Normal');
    expect(await answer).toBe('Normal');
  });

  test('keeps one process and answers concurrent queries in order', async () => {
    const { host, spawned } = harness();
    const first = host.query('status', 'A');
    const second = host.query('paper', 'B');
    const probe = spawned[0] as FakeProbe;
    await nextRequests(probe, 2);
    probe.reply('ok PaperOut');
    probe.reply('ok {"PaperWidth":600}');
    expect(await first).toBe('PaperOut');
    expect(await second).toBe('{"PaperWidth":600}');
    expect(spawned).toHaveLength(1);
  });

  test('reports a failed query as unknown and logs why', async () => {
    const { host, spawned, warnings } = harness();
    const answer = host.query('status', 'Missing');
    const probe = spawned[0] as FakeProbe;
    await nextRequests(probe, 1);
    probe.reply('err No printer found');
    expect(await answer).toBeNull();
    expect(warnings.some((warning) => warning.includes('No printer found'))).toBe(true);
  });

  test('restarts the process after it exits', async () => {
    const { host, spawned } = harness();
    const pending = host.query('status', 'A');
    (spawned[0] as FakeProbe).emit('exit', 1);
    expect(await pending).toBeNull();
    const retried = host.query('status', 'A');
    const probe = spawned[1] as FakeProbe;
    await nextRequests(probe, 1);
    probe.reply('ok Normal');
    expect(await retried).toBe('Normal');
  });

  test('kills a hung process on timeout so the next query starts fresh', async () => {
    const { host, spawned } = harness();
    expect(await host.query('status', 'A')).toBeNull();
    expect((spawned[0] as FakeProbe).isKilled).toBe(true);
    const retried = host.query('status', 'A');
    const probe = spawned[1] as FakeProbe;
    await nextRequests(probe, 1);
    probe.reply('ok Normal');
    expect(await retried).toBe('Normal');
  });

  test('dispose stops the process and answers pending queries as unknown', async () => {
    const { host, spawned } = harness();
    const pending = host.query('status', 'A');
    host.dispose();
    expect(await pending).toBeNull();
    expect((spawned[0] as FakeProbe).isKilled).toBe(true);
  });
});
