import type {
  ActionResult,
  PrinterFacts,
  QueueFacts,
  SpoolerFacts,
  UsbFacts,
} from '../../core/diagnosis/diagnosis-model';
import { choosePrintTicketPaper } from '../../core/diagnosis/paper-choice';
import type { PaperSize } from '../../shared/paper-sizes';
import type { ProbeCommand } from '../printing/printer-probe-host';
import { ELEVATION_DECLINED_EXIT_CODE, type PowerShellRun } from '../windows-powershell';
import type { DiagnosisSystem } from './diagnosis-system';
import {
  parseJobsReply,
  parsePaperOptionsReply,
  parsePrinterReply,
  parseSpoolerReply,
  parseUsbReply,
} from './windows-facts';
import {
  cancelJobsScript,
  purgeQueueScript,
  restartSpoolerScript,
  SCRIPT_EXIT,
  setDriverPaperScript,
} from './windows-scripts';

/** 等操作员在管理员确认框里点选，再加上脚本本身（服务停、启各最多 30 秒）：和防火墙一样给 2 分钟。 */
const ELEVATED_TIMEOUT_MS = 120_000;
/** 一次性 PowerShell：冷启动一两秒，加载 System.Printing 再一两秒。 */
const SCRIPT_TIMEOUT_MS = 15_000;

export interface WindowsDiagnosisDeps {
  /** 常驻探测进程（PrinterProbeHost.query）；查询失败为 null。 */
  query(command: ProbeCommand, printerName: string): Promise<string | null>;
  runScript(script: string, timeoutMs: number): Promise<PowerShellRun>;
  runElevated(script: string, timeoutMs: number): Promise<PowerShellRun>;
  openQueueWindow(printerName: string): Promise<void>;
}

function describeRun(run: PowerShellRun): string {
  return run.timedOut ? '系统命令超时了' : `系统命令出错（退出码 ${run.exitCode ?? '无'}，详情在日志里）`;
}

/** 管理员脚本的退出码 → 结果（提权后的窗口是隐藏的，只有退出码能带回来）。 */
export function elevatedResult(run: PowerShellRun): ActionResult {
  if (run.timedOut) {
    return { kind: 'failed', detail: '等管理员确认超时了' };
  }
  switch (run.exitCode) {
    case SCRIPT_EXIT.done:
      return { kind: 'done' };
    case ELEVATION_DECLINED_EXIT_CODE:
      return { kind: 'declined' };
    case SCRIPT_EXIT.driverRefused:
      return { kind: 'failed', detail: '驱动不接受这个尺寸，什么都没改' };
    case SCRIPT_EXIT.rolledBack:
      return { kind: 'rolled-back' };
    case SCRIPT_EXIT.userTicketFailed:
      return {
        kind: 'partial',
        detail:
          '驱动默认纸张已经设置成功，但当前账户的打印首选项没有同步更新（不影响静默打印），需要的话手动在打印首选项里调整一次',
      };
    default:
      return { kind: 'failed', detail: describeRun(run) };
  }
}

/** Windows：查询经常驻探测进程，动作经一次性或管理员 PowerShell。 */
export class WindowsDiagnosis implements DiagnosisSystem {
  readonly platform = 'windows' as const;

  constructor(private readonly deps: WindowsDiagnosisDeps) {}

  async spooler(): Promise<SpoolerFacts> {
    return parseSpoolerReply(await this.deps.query('spooler', ''));
  }

  async printer(printerName: string): Promise<PrinterFacts> {
    return parsePrinterReply(await this.deps.query('printer', printerName));
  }

  async usb(printerName: string): Promise<UsbFacts> {
    return parseUsbReply(await this.deps.query('usb', printerName));
  }

  async jobs(printerName: string): Promise<QueueFacts> {
    return parseJobsReply(await this.deps.query('jobs', printerName));
  }

  async restartSpooler(): Promise<ActionResult> {
    return elevatedResult(await this.deps.runElevated(restartSpoolerScript(), ELEVATED_TIMEOUT_MS));
  }

  async enablePrinter(): Promise<ActionResult> {
    // 管理员策略里 Windows 没有这个修复（暂停的打印机经「打开打印队列」恢复）：走到这里是程序错误。
    throw new Error('enable-printer is a macOS fix');
  }

  async openQueue(printerName: string): Promise<ActionResult> {
    await this.deps.openQueueWindow(printerName);
    return { kind: 'done' };
  }

  async cancelJobs(printerName: string, ids: readonly number[]): Promise<ActionResult> {
    const run = await this.deps.runScript(cancelJobsScript(printerName, ids), SCRIPT_TIMEOUT_MS);
    const count = Number(run.stdout.trim());
    if (run.exitCode !== SCRIPT_EXIT.done || !Number.isSafeInteger(count)) {
      return { kind: 'failed', detail: describeRun(run) };
    }
    return { kind: 'done', count };
  }

  async cancelAllJobs(printerName: string): Promise<ActionResult> {
    return elevatedResult(await this.deps.runElevated(purgeQueueScript(printerName), ELEVATED_TIMEOUT_MS));
  }

  /** 先不提权读驱动支持的纸张、挑好，挑不出来就不弹管理员确认；Windows 这一步本来就要管理员，admin 参数不改变行为。 */
  async setDriverPaper(printerName: string, target: PaperSize, _admin: boolean): Promise<ActionResult> {
    const options = parsePaperOptionsReply(await this.deps.query('paper-options', printerName));
    if (options === null) {
      return { kind: 'failed', detail: '读不到驱动支持的纸张' };
    }
    const paper = choosePrintTicketPaper(options, target);
    if (paper === null) {
      return { kind: 'no-matching-paper' };
    }
    return elevatedResult(
      await this.deps.runElevated(setDriverPaperScript(printerName, paper, target), ELEVATED_TIMEOUT_MS),
    );
  }
}
