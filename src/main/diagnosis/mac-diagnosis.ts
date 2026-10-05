import type {
  ActionResult,
  PrinterFacts,
  QueueFacts,
  SpoolerFacts,
  UsbFacts,
} from '../../core/diagnosis/diagnosis-model';
import { CUPS_MEDIA_KEYWORD_PATTERN, chooseCupsMedia } from '../../core/diagnosis/paper-choice';
import { isSamePaper, type PaperSize } from '../../shared/paper-sizes';
import { cupsPrinterUri, IPP_PROBE_TIMEOUT_MS, parseIppPaper } from '../printing/driver-paper';
import type { CommandRun, RunOptions } from './command-runner';
import type { DiagnosisSystem } from './diagnosis-system';
import {
  adminOsascriptArgs,
  adminPrompt,
  assertQueueName,
  CUPS_FORBIDDEN_PATTERN,
  cancelAllJobsCommand,
  enablePrinterCommand,
  MAC_TOOLS,
  restartCupsCommand,
  setMediaArgs,
  shellCommand,
  USER_CANCELED_PATTERN,
} from './mac-commands';
import {
  macUsbFacts,
  parseDeviceUri,
  parseIppJobs,
  parseIppPrinterState,
  parseSchedulerStatus,
  parseSystemProfilerUsb,
  readinessFromReasons,
} from './mac-facts';

/** lpstat、cancel、cupsenable 这类本机命令：连的是本机的 CUPS，几百毫秒内回答。 */
const QUERY: RunOptions = { timeoutMs: 5_000, maxOutputBytes: 256 * 1024 };
/** 改设置的命令（lpadmin 要改 PPD 并通知 cupsd）：多给一点时间。 */
const ACTION: RunOptions = { timeoutMs: 15_000, maxOutputBytes: 256 * 1024 };
/** system_profiler 要枚举整棵 USB 树，慢的机器上要几秒；JSON 有几十 KB。 */
const PROFILER: RunOptions = { timeoutMs: 20_000, maxOutputBytes: 4 * 1024 * 1024 };
/** Get-Jobs：和读打印机属性的 ipptool 同样的超时。 */
const JOBS: RunOptions = { timeoutMs: IPP_PROBE_TIMEOUT_MS, maxOutputBytes: 1024 * 1024 };
/** 等操作员输入管理员密码：和 Windows 的管理员确认一样给 2 分钟。 */
const ADMIN: RunOptions = { timeoutMs: 120_000, maxOutputBytes: 64 * 1024 };

export interface MacDiagnosisDeps {
  run(file: string, args: readonly string[], options: RunOptions): Promise<CommandRun>;
  /** driver-paper.ts 的 readIppAttributes。 */
  ippAttributes(printerName: string): Promise<string | null>;
  currentUser: string;
  /** 把 CUPS_GET_JOBS_TEST 写进一个临时文件，用完删掉。 */
  withJobsTest<T>(use: (path: string) => Promise<T>): Promise<T>;
}

function describeRun(run: CommandRun): string {
  return run.timedOut ? '系统命令超时了' : `系统命令出错（退出码 ${run.exitCode ?? '无'}，详情在日志里）`;
}

/** macOS：CUPS 命令行；改 CUPS 的动作先以当前用户做，被拒再由操作员点管理员按钮经 osascript 做。 */
export class MacDiagnosis implements DiagnosisSystem {
  readonly platform = 'mac' as const;

  constructor(private readonly deps: MacDiagnosisDeps) {}

  async spooler(printerName: string | null): Promise<SpoolerFacts> {
    const lpstat = await this.deps.run(MAC_TOOLS.lpstat, ['-r'], QUERY);
    const isRunning = parseSchedulerStatus(lpstat.timedOut ? null : lpstat.stdout);
    if (isRunning === null) {
      return { kind: 'unknown', reason: `lpstat -r: ${lpstat.stdout.slice(0, 80)} ${lpstat.stderr.slice(0, 80)}` };
    }
    if (!isRunning || printerName === null) {
      return { kind: 'mac', schedulerRunning: isRunning, queue: null };
    }
    const attributes = await this.deps.ippAttributes(printerName);
    const state = attributes === null ? null : parseIppPrinterState(attributes);
    const queue =
      state === null || state.state === null || state.acceptingJobs === null
        ? null
        : { enabled: state.state !== 'stopped', acceptingJobs: state.acceptingJobs };
    return { kind: 'mac', schedulerRunning: true, queue };
  }

  async printer(printerName: string): Promise<PrinterFacts> {
    const attributes = await this.deps.ippAttributes(printerName);
    if (attributes === null) {
      return { kind: 'unknown', reason: 'ipptool get-printer-attributes failed' };
    }
    const state = parseIppPrinterState(attributes);
    // paused 在后台打印服务一项说（cupsenable 恢复），这里不重复。
    return {
      kind: 'known',
      readiness: readinessFromReasons(state.reasons),
      paused: false,
      driverName: state.makeAndModel,
    };
  }

  async usb(printerName: string): Promise<UsbFacts> {
    assertQueueName(printerName);
    const lpstat = await this.deps.run(MAC_TOOLS.lpstat, ['-v', printerName], QUERY);
    const uri = parseDeviceUri(lpstat.exitCode === 0 ? lpstat.stdout : null);
    if (uri === null || !uri.startsWith('usb:')) {
      return macUsbFacts(uri, []);
    }
    const profiler = await this.deps.run(
      MAC_TOOLS.systemProfiler,
      ['-json', 'SPUSBDataType', 'SPUSBHostDataType'],
      PROFILER,
    );
    return macUsbFacts(uri, parseSystemProfilerUsb(profiler.exitCode === 0 ? profiler.stdout : null));
  }

  async jobs(printerName: string): Promise<QueueFacts> {
    const run = await this.deps.withJobsTest((path) =>
      this.deps.run(MAC_TOOLS.ipptool, ['-tv', cupsPrinterUri(printerName), path], JOBS),
    );
    return parseIppJobs(run.exitCode === 0 ? run.stdout : null, this.deps.currentUser);
  }

  async restartSpooler(): Promise<ActionResult> {
    return this.asAdmin(restartCupsCommand(), adminPrompt('重启打印系统（CUPS）'));
  }

  async enablePrinter(printerName: string, admin: boolean): Promise<ActionResult> {
    if (admin) {
      return this.asAdmin(enablePrinterCommand(printerName), adminPrompt(`恢复打印机「${printerName}」`));
    }
    assertQueueName(printerName);
    const enabled = await this.asUser(MAC_TOOLS.cupsenable, [printerName]);
    return enabled.kind === 'done' ? this.asUser(MAC_TOOLS.cupsaccept, [printerName]) : enabled;
  }

  async openQueue(): Promise<ActionResult> {
    // 管理员策略里 macOS 没有这个修复：走到这里是程序错误。
    throw new Error('open-queue is a Windows fix');
  }

  async cancelJobs(printerName: string, ids: readonly number[]): Promise<ActionResult> {
    assertQueueName(printerName);
    let count = 0;
    for (const id of ids) {
      const run = await this.deps.run(MAC_TOOLS.cancel, [String(id)], QUERY);
      if (run.exitCode === 0) {
        count += 1;
      } else {
        // 任务刚好打完了不算错：写日志，接着取消下一个。
        console.warn(`[diagnosis] cancel ${id} on ${printerName}: ${run.stderr.trim()}`);
      }
    }
    return { kind: 'done', count };
  }

  async cancelAllJobs(printerName: string): Promise<ActionResult> {
    return this.asAdmin(cancelAllJobsCommand(printerName), adminPrompt(`清空打印机「${printerName}」的队列`));
  }

  /** 挑纸张名 → 设默认 → 回读；回读不对就设回原来的（同样的权限方式）。 */
  async setDriverPaper(printerName: string, target: PaperSize, admin: boolean): Promise<ActionResult> {
    const before = await this.deps.ippAttributes(printerName);
    if (before === null) {
      return { kind: 'failed', detail: '读不到打印机的纸张设置' };
    }
    const state = parseIppPrinterState(before);
    const keyword = chooseCupsMedia(state.mediaSupported, target);
    if (keyword === null) {
      return { kind: 'no-matching-paper' };
    }
    const applied = await this.cups(
      setMediaArgs(printerName, keyword),
      admin,
      `把打印机「${printerName}」的默认纸张设为 ${keyword}`,
    );
    if (applied.kind !== 'done') {
      return applied;
    }
    const after = await this.deps.ippAttributes(printerName);
    const paper = after === null ? null : parseIppPaper(after);
    if (paper !== null && isSamePaper(paper, target)) {
      return { kind: 'done' };
    }
    const previous = state.mediaDefault;
    if (previous === null || !CUPS_MEDIA_KEYWORD_PATTERN.test(previous)) {
      return { kind: 'failed', detail: '设置之后回读的纸张不对，原来的设置读不到，没法恢复：打开打印首选项手动改' };
    }
    const restored = await this.cups(
      setMediaArgs(printerName, previous),
      admin,
      `把打印机「${printerName}」的默认纸张恢复成 ${previous}`,
    );
    return restored.kind === 'done'
      ? { kind: 'rolled-back' }
      : { kind: 'failed', detail: '设置之后回读的纸张不对，恢复原来的设置也没成：打开打印首选项手动改' };
  }

  private cups(args: readonly string[], admin: boolean, action: string): Promise<ActionResult> {
    return admin
      ? this.asAdmin(shellCommand(MAC_TOOLS.lpadmin, args), adminPrompt(action))
      : this.asUser(MAC_TOOLS.lpadmin, args);
  }

  private async asUser(file: string, args: readonly string[]): Promise<ActionResult> {
    const run = await this.deps.run(file, args, ACTION);
    if (run.exitCode === 0) {
      return { kind: 'done' };
    }
    if (CUPS_FORBIDDEN_PATTERN.test(run.stderr)) {
      return { kind: 'needs-admin' };
    }
    console.warn(`[diagnosis] ${file} ${args.join(' ')} failed: ${run.stderr.trim()}`);
    return { kind: 'failed', detail: describeRun(run) };
  }

  private async asAdmin(command: string, prompt: string): Promise<ActionResult> {
    const run = await this.deps.run(MAC_TOOLS.osascript, adminOsascriptArgs(command, prompt), ADMIN);
    if (run.exitCode === 0) {
      return { kind: 'done' };
    }
    if (USER_CANCELED_PATTERN.test(run.stderr)) {
      return { kind: 'declined' };
    }
    console.warn(`[diagnosis] admin command failed: ${run.stderr.trim()}`);
    return { kind: 'failed', detail: describeRun(run) };
  }
}
