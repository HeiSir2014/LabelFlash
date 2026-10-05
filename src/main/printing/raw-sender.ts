import { spawn } from 'node:child_process';
import { BRAND } from '../../shared/brand';
import type { RawSendFailureKind } from '../../shared/printer-commands';
import type { PrinterProbeHost, ProbeReply } from './printer-probe-host';

/**
 * 发送结果：ok 只表示系统的打印服务收下了（Windows 进了后台打印队列，macOS 交给了 CUPS），
 * 打印机有没有照做程序不知道。
 */
export type RawSendResult = { ok: true } | { ok: false; failure: RawSendFailure };

export interface RawSendFailure {
  kind: RawSendFailureKind;
  /** 原始说明：写日志；界面只在 kind 为 error 时摘一段显示。 */
  detail: string;
}

/** 把字节原样发给一台系统打印机。调用方保证打印机在系统列表里、字节是我们生成的指令。 */
export interface RawSender {
  send(printerName: string, data: Uint8Array): Promise<RawSendResult>;
}

/** winspool 的错误码 → 操作员能做什么。 */
const WIN32_FAILURES: Readonly<Record<number, RawSendFailureKind>> = {
  /** ERROR_ACCESS_DENIED */
  5: 'access-denied',
  /** ERROR_INVALID_PRINTER_NAME */
  1801: 'not-found',
  /** ERROR_INVALID_DATATYPE：这台打印机的打印处理器不收 RAW 数据。 */
  1804: 'raw-rejected',
};
const WIN32_ERROR_PATTERN = /^win32:(\d+) /;

/** 探测进程的回答 → 发送结果。 */
export function rawResultFromProbe(reply: ProbeReply): RawSendResult {
  if (reply.ok) {
    return { ok: true };
  }
  if (reply.error === null) {
    return reply.neverStarted
      ? {
          ok: false,
          failure: { kind: 'not-sent', detail: 'the printer probe restarted before this command was read' },
        }
      : { ok: false, failure: { kind: 'uncertain', detail: 'the printer probe stopped answering' } };
  }
  const code = Number(WIN32_ERROR_PATTERN.exec(reply.error)?.[1]);
  return { ok: false, failure: { kind: WIN32_FAILURES[code] ?? 'error', detail: reply.error } };
}

/** Windows：经常驻探测进程调用 winspool（见 printer-probe-host.ts）。 */
export class WindowsRawSender implements RawSender {
  constructor(private readonly host: Pick<PrinterProbeHost, 'sendRaw'>) {}

  async send(printerName: string, data: Uint8Array): Promise<RawSendResult> {
    return rawResultFromProbe(await this.host.sendRaw(printerName, data));
  }
}

/** lp 只把任务交给 CUPS 排队，正常不到 1 秒；和探测进程一样等 10 秒，还没结束说明 CUPS 卡住了。 */
export const LP_TIMEOUT_MS = 10_000;
const LP_PATH = '/usr/bin/lp';
/** 子进程的输出只留这么多字：lp 正常只回一行。 */
const MAX_OUTPUT_CHARS = 2_000;
const ASCII_MAX = 0x7f;

export interface ProcessOutcome {
  /** 退出码；没起来或被结束时为 null。 */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** 起一个子进程，把 input 写进它的标准输入（测试里换成假的）。 */
export type RunWithInput = (
  file: string,
  args: readonly string[],
  input: Uint8Array,
  timeoutMs: number,
) => Promise<ProcessOutcome>;

/**
 * lp 的参数：-d 队列名（参数数组传入，不经过 shell）；-o raw 不经 CUPS 的过滤器，字节原样交给后端；
 * -t 任务名；不给文件名时 lp 从标准输入读。
 */
export function lpArguments(printerName: string, title: string): string[] {
  return ['-d', printerName, '-o', 'raw', '-t', title];
}

/** macOS：`lp -o raw`，字节走标准输入。 */
export class MacRawSender implements RawSender {
  constructor(
    private readonly run: RunWithInput,
    private readonly title: string,
  ) {}

  async send(printerName: string, data: Uint8Array): Promise<RawSendResult> {
    const outcome = await this.run(LP_PATH, lpArguments(printerName, this.title), data, LP_TIMEOUT_MS);
    if (outcome.timedOut) {
      return { ok: false, failure: { kind: 'uncertain', detail: `lp did not finish within ${LP_TIMEOUT_MS}ms` } };
    }
    if (outcome.code !== 0) {
      const detail = (outcome.stderr || outcome.stdout).trim() || `lp exited with code ${outcome.code}`;
      return { ok: false, failure: { kind: 'error', detail } };
    }
    return { ok: true };
  }
}

/** 不经过 shell 起子进程，把 input 写进标准输入；超时就结束它。 */
export const runWithInput: RunWithInput = (file, args, input, timeoutMs) =>
  new Promise((resolve) => {
    const child = spawn(file, [...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let isSettled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    const settle = (outcome: ProcessOutcome) => {
      if (!isSettled) {
        isSettled = true;
        clearTimeout(timer);
        resolve(outcome);
      }
    };
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = `${stdout}${chunk.toString('utf8')}`.slice(0, MAX_OUTPUT_CHARS);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(0, MAX_OUTPUT_CHARS);
    });
    // 子进程提前退出时写标准输入会出错：原因记进 stderr，结果由退出码说明。
    child.stdin.on('error', (error) => {
      stderr = `${stderr}${error.message}`.slice(0, MAX_OUTPUT_CHARS);
    });
    child.once('error', (error) => settle({ code: null, stdout, stderr: error.message, timedOut: false }));
    child.once('close', (code) => settle({ code, stdout, stderr, timedOut }));
    child.stdin.end(Buffer.from(input));
  });

function unsupportedSender(detail: string): RawSender {
  return { send: async () => ({ ok: false, failure: { kind: 'unsupported', detail } }) };
}

/** 按平台选发送方式：Windows 要有探测进程；macOS 用 lp；其他平台不支持。 */
export function createRawSender(platform: NodeJS.Platform, host: PrinterProbeHost | null): RawSender {
  switch (platform) {
    case 'win32':
      return host === null ? unsupportedSender('the printer probe is not running') : new WindowsRawSender(host);
    case 'darwin':
      return new MacRawSender(runWithInput, BRAND.productNameAscii);
    default:
      return unsupportedSender(`raw printer commands are not supported on ${platform}`);
  }
}

/** 指令都是 ASCII：生成的文字里有别的字符说明生成器错了，立即抛出，不把乱码发给打印机。 */
export function asciiBytes(text: string): Uint8Array {
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) > ASCII_MAX) {
      throw new Error(`Printer commands must be ASCII, got code ${text.charCodeAt(index)} at ${index}`);
    }
  }
  return Buffer.from(text, 'ascii');
}
