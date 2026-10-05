import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { DIAGNOSIS_LIMITS } from '../../core/diagnosis/diagnosis-model';
import { RAW_COMMAND_MAX_BYTES } from '../../core/printer-commands/command-model';
import { BRAND } from '../../shared/brand';

/** 常驻探测进程能回答的问题：状态、驱动纸张、驱动名（打印时用），以及诊断用的几项（打印机页点「诊断」时才问）。 */
export const PROBE_COMMANDS = [
  'status',
  'paper',
  'driver',
  'spooler',
  'printer',
  'usb',
  'jobs',
  'paper-options',
] as const;
export type ProbeCommand = (typeof PROBE_COMMANDS)[number];

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
 * 一行回答的长度上限（字符）：最长的是队列（100 个任务 × 约 300 字）和纸张选项（200 种 × 约 150 字），
 * 都在 4 万字以内；512K 是给异常输出的硬上限，超过的整行丢掉、按「查不到」处理。
 */
export const MAX_PROBE_REPLY_LENGTH = 512 * 1024;
/** Print Schema 的命名空间名（不是网络地址）：读驱动的 PrintCapabilities 要用它定位节点。 */
const PRINT_SCHEMA_FRAMEWORK = 'http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework';

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
 * - 诊断用的几个命令（spooler/printer/usb/jobs/paper-options）只在点「诊断」时才问，一问一答开销不大：
 *   `-InputObject` 是因为只有一个元素的数组用管道传给 `ConvertTo-Json` 会被拆开，变成对象而不是数组；
 *   `Get-PnpDevice -InstanceId 'USBPRINT\\*'` 包括现在不在的设备（Present = $false），
 *   所以能说「系统记得它，但现在没连上」，问题代码用 Win32_PnPEntity 自带的 ConfigManagerErrorCode；
 *   拔过的旧 USB 打印设备会一直留在这个列表里，超过上限要截断时先把 Present 的排到前面，
 *   不然当前这台可能因为排在旧设备后面被截掉、查成「找不到」；
 *   `paper-options` 用 .NET 的 System.Printing（全局程序集缓存里的系统程序集，不是编译出来的代码）
 *   读驱动的 PrintCapabilities；XmlResolver 设为 $null 不解析外部实体；
 *   `jobs` 的 `SubmittedTime` 转成带偏移量的 ISO 字符串（`zzz`），不在这里转成 Unix 毫秒：
 *   `Get-PrintJob` 给的 `[DateTime]` 的 `Kind` 不确定是 Local 还是 Unspecified，转 `[DateTimeOffset]`
 *   时按「当前系统时区」当成本地时间处理——这是假设，真的是不是本地时间还没有在真机（尤其中文 Windows）
 *   上核对过（见 docs/roadmap.md）；带偏移量的字符串至少能让主进程按偏移量正确解析，不会多一次
 *   「当成 UTC 直接读」的错误；这些命令都在下面的 try 里，出错一样回 err …，主进程按「查不到」处理。
 */
export const PROBE_SCRIPT = `
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
      'spooler' {
        $service = Get-Service -Name 'Spooler'
        $reply = 'ok ' + (ConvertTo-Json -Compress -InputObject ([ordered]@{
          status = $service.Status.ToString(); startType = $service.StartType.ToString() }))
      }
      'printer' {
        $printer = Get-Printer -Name ([Management.Automation.WildcardPattern]::Escape($name))
        $reply = 'ok ' + (ConvertTo-Json -Compress -InputObject ([ordered]@{
          status = $printer.PrinterStatus.ToString(); portName = [string]$printer.PortName; driverName = [string]$printer.DriverName }))
      }
      'usb' {
        $printer = Get-Printer -Name ([Management.Automation.WildcardPattern]::Escape($name))
        $devices = @(Get-PnpDevice -InstanceId 'USBPRINT\\*' -ErrorAction SilentlyContinue |
          Sort-Object -Property Present -Descending | Select-Object -First ${DIAGNOSIS_LIMITS.usbDevices} | ForEach-Object {
            [ordered]@{ instanceId = [string]$_.InstanceId; name = [string]$_.FriendlyName; present = [bool]$_.Present; problem = [int]$_.ConfigManagerErrorCode }
          })
        $reply = 'ok ' + (ConvertTo-Json -Compress -Depth 4 -InputObject ([ordered]@{ port = [string]$printer.PortName; devices = $devices }))
      }
      'jobs' {
        $printer = Get-Printer -Name ([Management.Automation.WildcardPattern]::Escape($name))
        $all = @(Get-PrintJob -PrinterObject $printer)
        $jobs = @($all | Select-Object -First ${DIAGNOSIS_LIMITS.jobs} | ForEach-Object {
          $document = [string]$_.DocumentName
          [ordered]@{
            id = [int]$_.Id
            document = $document.Substring(0, [Math]::Min($document.Length, ${DIAGNOSIS_LIMITS.textLength}))
            user = [string]$_.UserName
            status = $_.JobStatus.ToString()
            submittedAt = ([DateTimeOffset]$_.SubmittedTime).ToString('yyyy-MM-ddTHH:mm:sszzz')
          }
        })
        $reply = 'ok ' + (ConvertTo-Json -Compress -Depth 4 -InputObject ([ordered]@{ user = [Environment]::UserName; total = $all.Count; jobs = $jobs }))
      }
      'paper-options' {
        Add-Type -AssemblyName System.Printing
        $queue = (New-Object System.Printing.LocalPrintServer).GetPrintQueue($name)
        $xml = New-Object System.Xml.XmlDocument
        $xml.XmlResolver = $null
        $xml.Load($queue.GetPrintCapabilitiesAsXml())
        $ns = New-Object System.Xml.XmlNamespaceManager $xml.NameTable
        $ns.AddNamespace('psf', '${PRINT_SCHEMA_FRAMEWORK}')
        $options = @($xml.SelectNodes("//psf:Feature[substring-after(@name, ':') = 'PageMediaSize']/psf:Option", $ns) |
          Select-Object -First ${DIAGNOSIS_LIMITS.paperOptions} | ForEach-Object {
            $qname = [string]$_.GetAttribute('name')
            $prefix = if ($qname.Contains(':')) { $qname.Split(':')[0] } else { '' }
            $width = $_.SelectSingleNode("psf:ScoredProperty[substring-after(@name, ':') = 'MediaSizeWidth']/psf:Value", $ns)
            $height = $_.SelectSingleNode("psf:ScoredProperty[substring-after(@name, ':') = 'MediaSizeHeight']/psf:Value", $ns)
            [ordered]@{
              namespace = [string]$_.GetNamespaceOfPrefix($prefix)
              localName = $qname.Substring($qname.IndexOf(':') + 1)
              width = if ($width) { [int]$width.InnerText } else { $null }
              height = if ($height) { [int]$height.InnerText } else { $null }
            }
          })
        $custom = $null -ne $xml.SelectSingleNode("//psf:ParameterDef[substring-after(@name, ':') = 'PageMediaSizeMediaSizeWidth']", $ns)
        $reply = 'ok ' + (ConvertTo-Json -Compress -Depth 4 -InputObject ([ordered]@{ options = $options; custom = $custom }))
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
    if (line.length > MAX_PROBE_REPLY_LENGTH) {
      this.warn(`[printer-probe] dropped a ${line.length}-character answer (limit ${MAX_PROBE_REPLY_LENGTH})`);
      query.resolve({ ok: false, error: null });
      return;
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
