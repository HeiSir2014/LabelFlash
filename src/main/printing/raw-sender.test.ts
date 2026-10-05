import { describe, expect, test } from 'bun:test';
import {
  asciiBytes,
  createRawSender,
  LP_TIMEOUT_MS,
  MacRawSender,
  type ProcessOutcome,
  type RunWithInput,
  rawResultFromProbe,
  runWithInput,
  WindowsRawSender,
} from './raw-sender';

const TITLE = 'CDL-LabelFlash';
const FEED = Buffer.from('FORMFEED\r\n');
/** 子进程测试的时限：起一个 Bun 进程不到 1 秒。 */
const CHILD_TIMEOUT_MS = 5_000;
/** 「超时」用例：子进程会一直等，这么久就结束它。 */
const SHORT_TIMEOUT_MS = 200;

describe('rawResultFromProbe', () => {
  test('treats an answer from the spooler as sent', () => {
    expect(rawResultFromProbe({ ok: true, payload: '17' })).toEqual({ ok: true });
  });

  test('maps winspool error codes to what the operator can do', () => {
    const cases = [
      ['win32:1801 OpenPrinter failed: 打印机名无效。', 'not-found'],
      ['win32:5 OpenPrinter failed: 拒绝访问。', 'access-denied'],
      ['win32:1804 StartDocPrinter failed: 数据类型无效。', 'raw-rejected'],
      ['win32:31 WritePrinter failed: 连到系统上的设备没有发挥作用。', 'error'],
      ['raw payload has 0 bytes', 'error'],
    ] as const;
    for (const [error, kind] of cases) {
      expect(rawResultFromProbe({ ok: false, error })).toEqual({ ok: false, failure: { kind, detail: error } });
    }
  });

  test('cannot tell whether it was sent when the probe stopped answering', () => {
    expect(rawResultFromProbe({ ok: false, error: null })).toMatchObject({ ok: false, failure: { kind: 'uncertain' } });
  });
});

describe('WindowsRawSender', () => {
  test('sends through the probe and maps its answer', async () => {
    const calls: string[] = [];
    const sender = new WindowsRawSender({
      sendRaw: async (printerName, data) => {
        calls.push(`${printerName}:${Buffer.from(data).toString('latin1')}`);
        return { ok: true, payload: '3' };
      },
    });
    expect(await sender.send('标签机A', FEED)).toEqual({ ok: true });
    expect(calls).toEqual(['标签机A:FORMFEED\r\n']);
  });
});

describe('MacRawSender', () => {
  function senderWith(outcome: ProcessOutcome) {
    const calls: { file: string; args: string[]; input: string; timeoutMs: number }[] = [];
    const run: RunWithInput = async (file, args, input, timeoutMs) => {
      calls.push({ file, args: [...args], input: Buffer.from(input).toString('latin1'), timeoutMs });
      return outcome;
    };
    return { sender: new MacRawSender(run, TITLE), calls };
  }

  test('pipes the bytes to lp with the raw option, without a shell', async () => {
    const { sender, calls } = senderWith({
      code: 0,
      stdout: 'request id is Label-12 (1 file(s))\n',
      stderr: '',
      timedOut: false,
    });
    expect(await sender.send('Label_Printer', FEED)).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        file: '/usr/bin/lp',
        args: ['-d', 'Label_Printer', '-o', 'raw', '-t', TITLE],
        input: 'FORMFEED\r\n',
        timeoutMs: LP_TIMEOUT_MS,
      },
    ]);
  });

  test('reports what lp printed when it fails', async () => {
    const { sender } = senderWith({
      code: 1,
      stdout: '',
      stderr: 'lp: The printer or class does not exist.\n',
      timedOut: false,
    });
    expect(await sender.send('Gone', FEED)).toEqual({
      ok: false,
      failure: { kind: 'error', detail: 'lp: The printer or class does not exist.' },
    });
  });

  test('treats an lp that does not finish as uncertain', async () => {
    const { sender } = senderWith({ code: null, stdout: '', stderr: '', timedOut: true });
    expect(await sender.send('Busy', FEED)).toMatchObject({ ok: false, failure: { kind: 'uncertain' } });
  });
});

describe('createRawSender', () => {
  test('refuses platforms without a raw path', async () => {
    expect(await createRawSender('linux', null).send('A', FEED)).toMatchObject({
      ok: false,
      failure: { kind: 'unsupported' },
    });
    // 探测进程没起来（例如用着假打印机）时 Windows 也发不了。
    expect(await createRawSender('win32', null).send('A', FEED)).toMatchObject({
      ok: false,
      failure: { kind: 'unsupported' },
    });
  });
});

describe('runWithInput', () => {
  // 用正在跑测试的 Bun 自己当子进程：两个平台都有，把标准输入原样写回标准输出。
  test('pipes the input to the program and collects its output', async () => {
    // top-level await（不是 .then()）：Bun 1.4 下 .then() 回调里的写入有时会在进程退出前来不及落盘。
    const echo = 'const text = await Bun.stdin.text(); process.stdout.write(text);';
    expect(await runWithInput(process.execPath, ['-e', echo], FEED, CHILD_TIMEOUT_MS)).toEqual({
      code: 0,
      stdout: 'FORMFEED\r\n',
      stderr: '',
      timedOut: false,
    });
  });

  test('ends a program that runs too long', async () => {
    const outcome = await runWithInput(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], FEED, SHORT_TIMEOUT_MS);
    expect(outcome.timedOut).toBe(true);
  });
});

describe('asciiBytes', () => {
  test('encodes command text byte for byte', () => {
    expect([...asciiBytes('~PH\n')]).toEqual([0x7e, 0x50, 0x48, 0x0a]);
  });

  test('fails fast on anything that is not ASCII', () => {
    expect(() => asciiBytes('SIZE 60 mm,40 mm\r\n纸')).toThrow('ASCII');
  });
});
