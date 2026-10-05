import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { RAW_COMMAND_MAX_BYTES } from '../../core/printer-commands/command-model';
import { BRAND } from '../../shared/brand';

export type ProbeCommand = 'status' | 'paper' | 'driver';

/**
 * 一次请求的回答：ok 带内容；否则 error 是探测进程报的原因（Win32 错误写成「win32:<错误码> <说明>」）。
 * error 为 null 表示进程超时或退出了：这次请求当时正在处理，不知道做到了哪一步。
 * neverStarted 为 true 时更确定：这次请求当时还排在队里，连行都没被探测进程读到，所以明确没发出去
 * （不是「不确定」，是「确定没发」），只有 error 为 null 时才可能出现。
 */
export type ProbeReply = { ok: true; payload: string } | { ok: false; error: string | null; neverStarted?: boolean };

/** 常驻探测进程需要的最小接口（便于测试替换成假进程）。 */
export interface ProbeProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  kill(): boolean;
  once(event: 'exit', listener: (code: number | null) => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
}

/** 首次查询包含 PowerShell 启动和模块加载（约 1–2 秒），之后每次约十几毫秒。 */
export const PROBE_QUERY_TIMEOUT_MS = 10_000;
/**
 * 原样发送比状态、纸张、驱动名查询多了真正的打印机 I/O（StartDocPrinter、WritePrinter）：
 * 打印机忙、驱动在排队或联机打印机响应慢时都可能比探测查询久得多；给够 30 秒，
 * 避免把仍在正常处理的慢发送误判成卡住并重启探测进程。
 */
export const RAW_SEND_TIMEOUT_MS = 30_000;
const MAX_STDERR_LOG_LENGTH = 500;

/**
 * 原样发送字节（RAW）的 C# 辅助类，探测进程第一次收到 raw 请求时用 Add-Type 编译，之后复用。
 * - 用 Unicode 版的 winspool 函数（OpenPrinterW、StartDocPrinterW）：中文打印机名不受系统代码页影响。
 * - 数据类型 RAW：打印处理器不加工，字节原样交给端口；驱动不收 RAW 时 StartDocPrinter 报 ERROR_INVALID_DATATYPE（1804）。
 * - 只用 C# 5 的语法：Windows PowerShell 5.1 的 Add-Type 用 .NET Framework 自带的编译器。
 * - 每一步失败都抛 Win32Exception，带 GetLastWin32Error 的错误码；EndPagePrinter 会改掉错误码，所以先取再收尾。
 */
const RAW_PRINTER_CSHARP = `
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

namespace LabelFlash {
  public static class RawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private class DocInfo1 {
      public string pDocName;
      public string pOutputFile;
      public string pDatatype;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool OpenPrinter(string printerName, out IntPtr printer, IntPtr defaults);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool ClosePrinter(IntPtr printer);

    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int StartDocPrinter(IntPtr printer, int level, [In] DocInfo1 docInfo);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool EndDocPrinter(IntPtr printer);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool StartPagePrinter(IntPtr printer);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool EndPagePrinter(IntPtr printer);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool WritePrinter(IntPtr printer, byte[] bytes, int count, out int written);

    public static int Send(string printerName, string documentName, byte[] data) {
      IntPtr printer;
      if (!OpenPrinter(printerName, out printer, IntPtr.Zero)) {
        throw Failure("OpenPrinter");
      }
      try {
        DocInfo1 info = new DocInfo1();
        info.pDocName = documentName;
        info.pOutputFile = null;
        info.pDatatype = "RAW";
        int jobId = StartDocPrinter(printer, 1, info);
        if (jobId == 0) {
          throw Failure("StartDocPrinter");
        }
        try {
          if (!StartPagePrinter(printer)) {
            throw Failure("StartPagePrinter");
          }
          int written;
          bool isWritten = WritePrinter(printer, data, data.Length, out written);
          int writeError = Marshal.GetLastWin32Error();
          EndPagePrinter(printer);
          if (!isWritten) {
            throw new Win32Exception(writeError, "WritePrinter failed: " + new Win32Exception(writeError).Message);
          }
          if (written != data.Length) {
            throw new InvalidOperationException("WritePrinter wrote " + written + " of " + data.Length + " bytes");
          }
        } finally {
          EndDocPrinter(printer);
        }
        return jobId;
      } finally {
        ClosePrinter(printer);
      }
    }

    private static Win32Exception Failure(string step) {
      int code = Marshal.GetLastWin32Error();
      return new Win32Exception(code, step + " failed: " + new Win32Exception(code).Message);
    }
  }
}
`;

/**
 * 常驻的 PowerShell 循环：每读一行请求就回答一行。
 * - 请求：「命令 空格 打印机名的 UTF-8 base64 [空格 数据的 base64]」。名字和数据只作为数据解码，永远不会被拼进脚本执行；
 *   base64 也绕开了控制台代码页（中文打印机名不会乱码）。
 * - 回答：「ok 内容」或「err 原因」，内容保证只有一行；Win32 错误写成「err win32:<错误码> <说明>」。
 * - Get-Printer -Name 支持通配符，名字要先转义；纸张用 Where-Object 精确匹配，不拼进 WQL。
 * - raw：数据 1–RAW_COMMAND_MAX_BYTES 字节（主进程查过，这里再查一次）；C# 第一次用到时才编译。
 * - 输出被重定向时，PowerShell 会把加载模块的进度条序列化成 CLIXML 写到 stderr，所以关掉进度输出。
 */
const PROBE_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$rawPrinterSource = @'
${RAW_PRINTER_CSHARP}
'@
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $reply = ''
  try {
    $command, $encoded, $payload = $line.Split(' ', 3)
    $name = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
    switch ($command) {
      'status' {
        $printer = Get-Printer -Name ([Management.Automation.WildcardPattern]::Escape($name))
        $reply = 'ok ' + $printer.PrinterStatus.ToString()
      }
      'paper' {
        $config = Get-CimInstance -ClassName Win32_PrinterConfiguration | Where-Object Name -eq $name | Select-Object -First 1
        $reply = 'ok '
        if ($config) {
          $reply += ($config | Select-Object PaperWidth, PaperLength, HorizontalResolution | ConvertTo-Json -Compress)
        }
      }
      'driver' {
        $printer = Get-Printer -Name ([Management.Automation.WildcardPattern]::Escape($name))
        $reply = 'ok ' + ($printer.DriverName -replace '\\s+', ' ')
      }
      'raw' {
        $data = [Convert]::FromBase64String($payload)
        if ($data.Length -lt 1 -or $data.Length -gt ${RAW_COMMAND_MAX_BYTES}) {
          throw ('raw payload has ' + $data.Length + ' bytes')
        }
        if ($null -eq ('LabelFlash.RawPrinter' -as [type])) {
          Add-Type -TypeDefinition $rawPrinterSource
        }
        $reply = 'ok ' + [LabelFlash.RawPrinter]::Send($name, '${BRAND.productNameAscii}', $data)
      }
      default { $reply = 'err unknown command ' + $command }
    }
  } catch {
    $win32 = $_.Exception.InnerException -as [ComponentModel.Win32Exception]
    if ($null -ne $win32) {
      $reply = 'err win32:' + $win32.NativeErrorCode + ' ' + ($win32.Message -replace '\\s+', ' ')
    } else {
      $reply = 'err ' + ($_.Exception.Message -replace '\\s+', ' ')
    }
  }
  [Console]::Out.WriteLine($reply)
  [Console]::Out.Flush()
}
`;

/** powershell.exe 的参数。-EncodedCommand（UTF-16LE base64）：多行脚本原样传入，不受命令行引号转义规则影响。 */
export function probeArguments(): string[] {
  const encoded = Buffer.from(PROBE_SCRIPT, 'utf16le').toString('base64');
  return ['-NoProfile', '-NonInteractive', '-NoLogo', '-EncodedCommand', encoded];
}

export function spawnPowerShellProbe(): ProbeProcess {
  return spawn('powershell.exe', probeArguments(), { windowsHide: true });
}

interface PendingQuery {
  resolve: (reply: ProbeReply) => void;
  command: string;
  timeoutMs: number;
  /**
   * 只有排在队首、确实在被探测进程处理的请求才有计时器；后面排队的请求先不计时，
   * 轮到它成为队首时才在 activate() 里补上，这样一个慢请求的超时不会连累还没开始的请求。
   */
  timer: ReturnType<typeof setTimeout> | null;
}

function encodeName(printerName: string): string {
  return Buffer.from(printerName, 'utf8').toString('base64');
}

/**
 * 打印机状态、驱动纸张、驱动名的查询和标签机指令的发送都经过这一个常驻进程。每次都新起 powershell.exe 要约 1 秒 CPU，
 * 按 5 秒一次轮询相当于长期占掉四分之一个核；常驻之后每次查询只要十几毫秒。
 * 请求按顺序排队，回答也按顺序到达；队首的请求（探测进程正在处理的）超时或进程退出、出错时按「不知道」返回，
 * 还没轮到的请求按「确定没发出去」返回（它们连行都没被探测进程读到）；两种情况都会让下一次请求重新启动进程。
 */
export class PrinterProbeHost {
  private process: ProbeProcess | null = null;
  private readonly pending: PendingQuery[] = [];

  constructor(
    private readonly spawnProcess: () => ProbeProcess,
    private readonly timeoutMs: number,
    private readonly warn: (message: string) => void,
    private readonly rawTimeoutMs: number = RAW_SEND_TIMEOUT_MS,
  ) {}

  /** 返回回答内容；查询失败、超时或进程异常时返回 null（按未知处理，不阻止打印）。 */
  async query(command: ProbeCommand, printerName: string): Promise<string | null> {
    const reply = await this.request(command, encodeName(printerName), this.timeoutMs);
    return reply.ok ? reply.payload : null;
  }

  /**
   * 把字节原样发给打印机（winspool，数据类型 RAW），回答里是后台打印队列的任务号。
   * 长度不在 1–RAW_COMMAND_MAX_BYTES 是调用方的错：立即抛 RangeError，不写给进程。
   */
  sendRaw(printerName: string, data: Uint8Array): Promise<ProbeReply> {
    if (data.length === 0 || data.length > RAW_COMMAND_MAX_BYTES) {
      throw new RangeError(`Raw printer commands must be 1-${RAW_COMMAND_MAX_BYTES} bytes, got ${data.length}`);
    }
    return this.request('raw', `${encodeName(printerName)} ${Buffer.from(data).toString('base64')}`, this.rawTimeoutMs);
  }

  dispose(): void {
    if (this.process) {
      this.stop(this.process);
    }
  }

  private request(command: string, args: string, timeoutMs: number): Promise<ProbeReply> {
    const child = this.ensureProcess();
    return new Promise((resolve) => {
      const query: PendingQuery = { resolve, command, timeoutMs, timer: null };
      const isNextUp = this.pending.length === 0;
      this.pending.push(query);
      child.stdin.write(`${command} ${args}\n`);
      // 队列原本是空的：这条请求马上就是探测进程要读的下一行，立即计时。
      if (isNextUp) {
        this.activate(child, query);
      }
    });
  }

  /** 队首的请求才计时：轮到它了，探测进程这时才会真的去读这一行。 */
  private activate(child: ProbeProcess, query: PendingQuery): void {
    query.timer = setTimeout(() => {
      this.warn(`[printer-probe] ${query.command} query timed out after ${query.timeoutMs}ms, restarting the probe`);
      this.stop(child);
    }, query.timeoutMs);
  }

  private ensureProcess(): ProbeProcess {
    if (this.process) {
      return this.process;
    }
    const child = this.spawnProcess();
    this.process = child;
    createInterface({ input: child.stdout }).on('line', (line) => this.onReply(line));
    child.stderr.on('data', (chunk: Buffer) => {
      this.warn(`[printer-probe] stderr: ${chunk.toString('utf8').slice(0, MAX_STDERR_LOG_LENGTH)}`);
    });
    child.stdin.on('error', (error) => {
      this.warn(`[printer-probe] could not send a query: ${error.message}`);
      this.stop(child);
    });
    child.once('error', (error) => {
      this.warn(`[printer-probe] could not start PowerShell: ${error.message}`);
      this.stop(child);
    });
    child.once('exit', (code) => {
      if (this.process === child) {
        this.warn(`[printer-probe] PowerShell exited with code ${code}`);
      }
      this.stop(child);
    });
    return child;
  }

  private onReply(line: string): void {
    const query = this.pending.shift();
    if (!query) {
      this.warn(`[printer-probe] unexpected output: ${line}`);
      return;
    }
    if (query.timer) {
      clearTimeout(query.timer);
    }
    if (line.startsWith('ok')) {
      query.resolve({ ok: true, payload: line.slice('ok'.length).trim() });
    } else {
      const error = line.replace(/^err\s*/, '');
      this.warn(`[printer-probe] query failed: ${error}`);
      query.resolve({ ok: false, error });
    }
    // 这一条处理完了：排在它后面的请求现在才是队首，从这时起才计时。
    const next = this.pending[0];
    if (next && this.process) {
      this.activate(this.process, next);
    }
  }

  /**
   * 丢弃这个进程：队首那条（探测进程当时正在处理的）按「不知道」返回；
   * 后面还没轮到的按「确定没发出去」返回——它们连行都没被探测进程读到。下次请求重新启动进程。
   */
  private stop(child: ProbeProcess): void {
    if (this.process !== child) {
      return;
    }
    this.process = null;
    this.pending.splice(0).forEach((query, index) => {
      if (query.timer) {
        clearTimeout(query.timer);
      }
      query.resolve(index === 0 ? { ok: false, error: null } : { ok: false, error: null, neverStarted: true });
    });
    child.kill();
  }
}
