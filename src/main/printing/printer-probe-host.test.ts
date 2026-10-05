import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { RAW_COMMAND_MAX_BYTES } from '../../core/printer-commands/command-model';
import {
  PROBE_QUERY_TIMEOUT_MS,
  PrinterProbeHost,
  type ProbeProcess,
  probeArguments,
  spawnPowerShellProbe,
} from './printer-probe-host';

const TIMEOUT_MS = 50;
/** Windows 命令行的长度上限（CreateProcess）。 */
const WINDOWS_COMMAND_LINE_MAX_CHARS = 32_767;
/** 真 PowerShell 第一次要加载模块、编译 C#：给足时间。 */
const REAL_PROBE_TIMEOUT_MS = PROBE_QUERY_TIMEOUT_MS * 2;
const REAL_PROBE_TEST_TIMEOUT_MS = REAL_PROBE_TIMEOUT_MS + 5_000;

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

  test('asks for the driver name with its own command', async () => {
    const { host, spawned } = harness();
    const answer = host.query('driver', '标签机A');
    const probe = spawned[0] as FakeProbe;
    expect(await nextRequests(probe, 1)).toEqual([`driver ${base64('标签机A')}`]);
    probe.reply('ok Label Printer TSPL');
    expect(await answer).toBe('Label Printer TSPL');
  });

  test('sends raw bytes and the printer name as base64 data on one line', async () => {
    const { host, spawned } = harness();
    const bytes = Buffer.from('FORMFEED\r\n');
    const answer = host.sendRaw('热敏标签机', bytes);
    const probe = spawned[0] as FakeProbe;
    expect(await nextRequests(probe, 1)).toEqual([`raw ${base64('热敏标签机')} ${bytes.toString('base64')}`]);
    probe.reply('ok 17');
    expect(await answer).toEqual({ ok: true, payload: '17' });
  });

  test('passes the winspool error of a failed raw send to the caller', async () => {
    const { host, spawned } = harness();
    const answer = host.sendRaw('A', Buffer.from('FORMFEED\r\n'));
    const probe = spawned[0] as FakeProbe;
    await nextRequests(probe, 1);
    probe.reply('err win32:1804 StartDocPrinter failed: 数据类型无效。');
    expect(await answer).toEqual({ ok: false, error: 'win32:1804 StartDocPrinter failed: 数据类型无效。' });
  });

  // 超时、进程退出：不知道打印机收没收到，上层按「不确定」处理。
  test('cannot tell whether a raw send happened when the probe stops answering', async () => {
    const { host } = harness();
    expect(await host.sendRaw('A', Buffer.from('FORMFEED\r\n'))).toEqual({ ok: false, error: null });
  });

  test('refuses an empty or oversized raw payload before writing anything', () => {
    const { host, spawned } = harness();
    expect(() => host.sendRaw('A', new Uint8Array(0))).toThrow(RangeError);
    expect(() => host.sendRaw('A', new Uint8Array(RAW_COMMAND_MAX_BYTES + 1))).toThrow(RangeError);
    expect(spawned).toHaveLength(0);
  });

  // 脚本整段经 -EncodedCommand 传入：加了 C# 之后整条命令行仍要在 CreateProcess 的 32767 字符以内。
  test('keeps the encoded probe script inside the Windows command line limit', () => {
    const commandLine = ['powershell.exe', ...probeArguments()].join(' ');
    expect(commandLine.length).toBeLessThan(WINDOWS_COMMAND_LINE_MAX_CHARS);
  });

  // 只在 Windows 上：真的启动 PowerShell、编译 C#、调用 winspool。向一台不存在的打印机发送，
  // 应当拿到带错误码的 Win32 错误（后台打印服务在跑是 1801，没跑可能是 1722），证明编译和 P/Invoke 都通了。
  test.skipIf(process.platform !== 'win32')(
    'compiles the raw helper and reports winspool errors with their code',
    async () => {
      const host = new PrinterProbeHost(spawnPowerShellProbe, REAL_PROBE_TIMEOUT_MS, () => {});
      try {
        const reply = await host.sendRaw('LabelFlash 测试用的不存在的打印机', Buffer.from('\r\n'));
        expect(reply).toMatchObject({ ok: false, error: expect.stringMatching(/^win32:\d+ OpenPrinter failed/) });
      } finally {
        host.dispose();
      }
    },
    REAL_PROBE_TEST_TIMEOUT_MS,
  );
});
