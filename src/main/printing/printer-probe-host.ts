import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

export type ProbeCommand = 'status' | 'paper';

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
const MAX_STDERR_LOG_LENGTH = 500;

/**
 * 常驻的 PowerShell 循环：每读一行请求就回答一行。
 * - 请求：「命令 空格 打印机名的 UTF-8 base64」。打印机名只作为数据解码，永远不会被拼进脚本执行；
 *   base64 也绕开了控制台代码页（中文打印机名不会乱码）。
 * - 回答：「ok 内容」或「err 原因」，内容保证只有一行。
 * - Get-Printer -Name 支持通配符，名字要先转义；纸张用 Where-Object 精确匹配，不拼进 WQL。
 * - 输出被重定向时，PowerShell 会把加载模块的进度条序列化成 CLIXML 写到 stderr，所以关掉进度输出。
 */
const PROBE_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $reply = ''
  try {
    $command, $encoded = $line.Split(' ', 2)
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
      default { $reply = 'err unknown command ' + $command }
    }
  } catch {
    $reply = 'err ' + ($_.Exception.Message -replace '\\s+', ' ')
  }
  [Console]::Out.WriteLine($reply)
  [Console]::Out.Flush()
}
`;

export function spawnPowerShellProbe(): ProbeProcess {
  // -EncodedCommand（UTF-16LE base64）：多行脚本原样传入，不受命令行引号转义规则影响。
  const encoded = Buffer.from(PROBE_SCRIPT, 'utf16le').toString('base64');
  return spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-NoLogo', '-EncodedCommand', encoded], {
    windowsHide: true,
  });
}

interface PendingQuery {
  resolve: (payload: string | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * 打印机状态和驱动纸张的查询都经过这一个常驻进程。每次查询都新起 powershell.exe 要约 1 秒 CPU，
 * 按 5 秒一次轮询相当于长期占掉四分之一个核；常驻之后每次查询只要十几毫秒。
 * 查询按顺序排队，回答也按顺序到达；进程退出、出错或卡住时，所有未完成的查询按「未知」返回，
 * 下一次查询自动重新启动进程。
 */
export class PrinterProbeHost {
  private process: ProbeProcess | null = null;
  private readonly pending: PendingQuery[] = [];

  constructor(
    private readonly spawnProcess: () => ProbeProcess,
    private readonly timeoutMs: number,
    private readonly warn: (message: string) => void,
  ) {}

  /** 返回回答内容；查询失败、超时或进程异常时返回 null（按未知处理，不阻止打印）。 */
  query(command: ProbeCommand, printerName: string): Promise<string | null> {
    const child = this.ensureProcess();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.warn(`[printer-probe] ${command} query timed out after ${this.timeoutMs}ms, restarting the probe`);
        this.stop(child);
      }, this.timeoutMs);
      this.pending.push({ resolve, timer });
      child.stdin.write(`${command} ${Buffer.from(printerName, 'utf8').toString('base64')}\n`);
    });
  }

  dispose(): void {
    if (this.process) {
      this.stop(this.process);
    }
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
    clearTimeout(query.timer);
    if (line.startsWith('ok')) {
      query.resolve(line.slice('ok'.length).trim());
    } else {
      this.warn(`[printer-probe] query failed: ${line.replace(/^err\s*/, '')}`);
      query.resolve(null);
    }
  }

  /** 丢弃这个进程：未完成的查询全部按未知返回，下次查询重新启动。 */
  private stop(child: ProbeProcess): void {
    if (this.process !== child) {
      return;
    }
    this.process = null;
    for (const query of this.pending.splice(0)) {
      clearTimeout(query.timer);
      query.resolve(null);
    }
    child.kill();
  }
}
