import type {
  ActionResult,
  CommandSetName,
  DiagnosisPlatform,
  PrinterFacts,
  QueueFacts,
  QueueJob,
  SpoolerFacts,
  UsbFacts,
} from '../../core/diagnosis/diagnosis-model';
import type { SubmittedJobs } from '../../core/diagnosis/submitted-jobs';
import type { Clock } from '../../core/types';
import type { PaperSize } from '../../shared/paper-sizes';
import type { FakePrinterSpec, FakePrinters } from '../printing/fake-printers';
import type { DiagnosisSystem } from './diagnosis-system';
import type { LabelCommandsSeam } from './seams';

/** 假队列里的任务提交于多久以前：远超卡住的门槛（1 分钟），断言和截图里的「等了 5 分钟」稳定。 */
const FAKE_JOB_AGE_MS = 5 * 60_000;
/** 假的当前用户和「别人」。 */
export const FAKE_CURRENT_USER = 'operator';
const FAKE_OTHER_USER = 'someone-else';
const DEFAULT_COMMAND_SET: CommandSetName = 'tspl';
/** 不是 USB 的假端口名（网络打印机的 WSD 端口长这样）。 */
const FAKE_NETWORK_PORT = 'WSD-1';
const FAKE_USB_PORT = 'USB001';

/**
 * 仅开发 / E2E：按 FakePrinterSpec.diagnosis 回答诊断，按修复改状态，不碰真的系统。
 * 「管理员确认」只记下来（adminPrompts），按 adminPrompt 决定点了「是」还是「否」。
 */
export class FakeDiagnosis implements DiagnosisSystem {
  /** 弹过的管理员确认（要做的事）：E2E 核对只在点了管理员按钮时才弹。 */
  readonly adminPrompts: string[] = [];
  /** 自动设置驱动纸张、打开打印首选项这类「打开系统窗口」的动作也只记下来。 */
  readonly openedWindows: string[] = [];
  private isSpoolerRunning: boolean;
  private readonly queues = new Map<string, QueueJob[]>();

  constructor(
    readonly platform: DiagnosisPlatform,
    private readonly specs: readonly FakePrinterSpec[],
    private readonly printers: FakePrinters,
    submitted: SubmittedJobs,
    clock: Clock,
  ) {
    this.isSpoolerRunning = !specs.some((spec) => spec.diagnosis?.spooler === 'stopped');
    const submittedAtMs = clock.now() - FAKE_JOB_AGE_MS;
    let nextId = 1;
    for (const spec of specs) {
      const { ours, others } = spec.diagnosis?.stuckJobs ?? { ours: 0, others: 0 };
      const jobs: QueueJob[] = [];
      for (let index = 0; index < ours + others; index += 1) {
        jobs.push({
          id: nextId,
          document: `假任务 ${nextId}`,
          user: index < ours ? FAKE_CURRENT_USER : FAKE_OTHER_USER,
          submittedAtMs,
          flags: ['error'],
        });
        nextId += 1;
      }
      this.queues.set(spec.name, jobs);
      if (ours > 0) {
        // 本程序的任务：账本里记一个盖住它们提交时间的时间段（和真的适配器交任务时一样）。
        submitted.record(spec.name, submittedAtMs);
      }
    }
  }

  async spooler(printerName: string | null): Promise<SpoolerFacts> {
    if (this.platform === 'windows') {
      return { kind: 'windows', state: this.isSpoolerRunning ? 'running' : 'stopped', startType: 'automatic' };
    }
    return {
      kind: 'mac',
      schedulerRunning: true,
      queue: printerName === null ? null : { enabled: this.isSpoolerRunning, acceptingJobs: true },
    };
  }

  async printer(printerName: string): Promise<PrinterFacts> {
    const readiness = this.spec(printerName)?.readiness ?? null;
    return readiness === null
      ? { kind: 'unknown', reason: 'the fake printer reports no status' }
      : { kind: 'known', readiness, paused: false, driverName: '假驱动' };
  }

  async usb(printerName: string): Promise<UsbFacts> {
    switch (this.spec(printerName)?.diagnosis?.usb ?? 'present') {
      case 'present':
        return { kind: 'present', deviceName: printerName };
      case 'disconnected':
        return { kind: 'disconnected', deviceName: printerName };
      case 'not-found':
        return { kind: 'not-found', port: FAKE_USB_PORT };
      case 'not-usb':
        return { kind: 'not-usb', port: FAKE_NETWORK_PORT };
    }
  }

  async jobs(printerName: string): Promise<QueueFacts> {
    const jobs = this.queues.get(printerName) ?? [];
    return { kind: 'listed', currentUser: FAKE_CURRENT_USER, total: jobs.length, jobs: [...jobs] };
  }

  async restartSpooler(): Promise<ActionResult> {
    if (!this.confirmAdmin(null, '重启后台打印服务')) {
      return { kind: 'declined' };
    }
    this.isSpoolerRunning = true;
    return { kind: 'done' };
  }

  async enablePrinter(printerName: string, admin: boolean): Promise<ActionResult> {
    if (admin && !this.confirmAdmin(printerName, '恢复这台打印机')) {
      return { kind: 'declined' };
    }
    this.isSpoolerRunning = true;
    return { kind: 'done' };
  }

  async openQueue(printerName: string): Promise<ActionResult> {
    this.openedWindows.push(`打印队列：${printerName}`);
    return { kind: 'done' };
  }

  /** 假的「打开打印首选项」：只记下来（DiagnosisStation 在假打印机模式下用它代替 rundll32）。 */
  async openPreferences(printerName: string): Promise<void> {
    this.openedWindows.push(`打印首选项：${printerName}`);
  }

  async cancelJobs(printerName: string, ids: readonly number[]): Promise<ActionResult> {
    const jobs = this.queues.get(printerName) ?? [];
    const kept = jobs.filter((job) => !ids.includes(job.id));
    this.queues.set(printerName, kept);
    return { kind: 'done', count: jobs.length - kept.length };
  }

  async cancelAllJobs(printerName: string): Promise<ActionResult> {
    if (!this.confirmAdmin(printerName, '清空队列')) {
      return { kind: 'declined' };
    }
    this.queues.set(printerName, []);
    return { kind: 'done' };
  }

  async setDriverPaper(printerName: string, target: PaperSize, admin: boolean): Promise<ActionResult> {
    // 和真的一样：先看驱动有没有这种纸，没有就不弹确认。
    if (this.spec(printerName)?.diagnosis?.paperSettable === false) {
      return { kind: 'no-matching-paper' };
    }
    // Windows 一定要管理员；macOS 先以当前用户做（假打印机直接成功）。
    if ((this.platform === 'windows' || admin) && !this.confirmAdmin(printerName, '设置驱动纸张')) {
      return { kind: 'declined' };
    }
    const dpi = (await this.printers.driverPaper(printerName))?.dpi ?? null;
    this.printers.setDriverPaper(printerName, { widthMm: target.widthMm, heightMm: target.heightMm, dpi });
    return { kind: 'done' };
  }

  private spec(printerName: string): FakePrinterSpec | undefined {
    return this.specs.find((spec) => spec.name === printerName);
  }

  private confirmAdmin(printerName: string | null, action: string): boolean {
    this.adminPrompts.push(action);
    const spec = printerName === null ? this.specs.find((item) => item.diagnosis?.adminPrompt) : this.spec(printerName);
    return spec?.diagnosis?.adminPrompt !== 'decline';
  }
}

/** 假打印机模式下的 5a 接缝：指令集按 FakeDiagnosisSpec.commandSet，发出的动作只记下来。 */
export class FakeLabelCommands implements LabelCommandsSeam {
  readonly sent: { printerName: string; action: 'feed' | 'calibrate' }[] = [];

  constructor(private readonly specs: readonly FakePrinterSpec[]) {}

  async effectiveCommandSet(printerName: string): Promise<CommandSetName | 'none'> {
    return this.specs.find((spec) => spec.name === printerName)?.diagnosis?.commandSet ?? DEFAULT_COMMAND_SET;
  }

  async send(printerName: string, action: 'feed' | 'calibrate'): Promise<ActionResult> {
    this.sent.push({ printerName, action });
    return { kind: 'done' };
  }
}
