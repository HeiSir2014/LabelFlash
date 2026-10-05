import type { ActionResult, DiagnosisFixRequest } from '../../core/diagnosis/diagnosis-model';
import { adminPolicy, fixOutcome } from '../../core/diagnosis/fixes';
import { summarizeQueue } from '../../core/diagnosis/queue-summary';
import type { SubmittedJobs } from '../../core/diagnosis/submitted-jobs';
import {
  commandsVerdict,
  missingPrinterVerdict,
  paperVerdict,
  printerVerdict,
  queueVerdict,
  spoolerVerdict,
  usbVerdict,
} from '../../core/diagnosis/verdicts';
import type { Clock } from '../../core/types';
import type { CheckVerdict, DiagnosisCheckId, FixOutcome } from '../../shared/diagnosis';
import type { DriverPaper } from '../../shared/driver-paper';
import type { PaperSize } from '../../shared/paper-sizes';
import type { DiagnosisSystem } from './diagnosis-system';
import type { DriverReinstallSeam, LabelCommandsSeam } from './seams';

export interface DiagnosisStationDeps {
  system: DiagnosisSystem;
  /** 系统打印机列表里有没有这台（PrinterDriver.hasPrinter）。 */
  isKnownPrinter(printerName: string): Promise<boolean>;
  /** 现读驱动纸张（PrinterProfiles.fresh）。 */
  driverPaper(printerName: string): Promise<DriverPaper | null>;
  /** 改了驱动设置之后丢掉缓存（PrinterProfiles.forget）。 */
  forgetProfile(printerName: string): void;
  /** 打开打印首选项（driver-paper.ts 的 openPrinterPreferences；假打印机模式下只记下来）。 */
  openPreferences(printerName: string): Promise<void>;
  submitted: SubmittedJobs;
  /** 5a；没有时「指令集」一项跳过。 */
  commands: LabelCommandsSeam | null;
  /** 5c；没有时不出现「重新安装驱动」。 */
  drivers: DriverReinstallSeam | null;
  clock: Clock;
  log(message: string): void;
}

/**
 * 诊断的主进程入口（界面经 printer:diagnosis-check / printer:diagnosis-fix 调它）：
 * - 打印机名不在系统列表里：检查说「已经没有这台了」，修复直接拒绝——都不交给系统命令（安全底线）；
 * - 修复按平台的管理员策略核对（管理员按钮必须是管理员按钮，反过来也一样），同一时间只做一个；
 * - 每次检查、修复都写日志（打印机、项目、结论或结果）。
 */
export class DiagnosisStation {
  private isFixing = false;

  constructor(private readonly deps: DiagnosisStationDeps) {}

  /** 查一项。printerName 为 null 时只能查后台打印服务；expected 是这台打印机负责的纸。 */
  async check(printerName: string | null, check: DiagnosisCheckId, expected: PaperSize | null): Promise<CheckVerdict> {
    const { system } = this.deps;
    if (printerName === null) {
      if (check !== 'spooler') {
        throw new Error(`Diagnosis check "${check}" needs a printer`);
      }
      return this.logged('(system)', spoolerVerdict(await system.spooler(null), system.platform));
    }
    if (!(await this.deps.isKnownPrinter(printerName))) {
      // 点「诊断」之后打印机被拔掉或删了：这不是程序错误，说清楚就行。
      return this.logged(printerName, missingPrinterVerdict(check));
    }
    return this.logged(printerName, await this.checkListed(printerName, check, expected));
  }

  /** 做一个修复。请求不合策略、打印机不在列表里、缺纸张：程序错误，直接抛（IPC 会写日志并告诉界面）。 */
  async fix(request: DiagnosisFixRequest): Promise<FixOutcome> {
    const { system } = this.deps;
    const policy = adminPolicy(system.platform, request.fix);
    const isAllowed =
      policy === 'optional' || (policy === 'always' && request.admin) || (policy === 'never' && !request.admin);
    if (!isAllowed) {
      throw new Error(`Fix "${request.fix}" with admin=${request.admin} is not allowed on ${system.platform}`);
    }
    const isSystemFix = request.fix === 'restart-spooler';
    const isListed = request.printerName === null ? isSystemFix : await this.deps.isKnownPrinter(request.printerName);
    if (!isListed) {
      throw new Error(`Fix "${request.fix}" needs a printer that is in the system list`);
    }
    if (this.isFixing) {
      throw new Error('Another diagnosis fix is still running');
    }
    this.isFixing = true;
    try {
      const result = await this.run(request);
      const detail = result.kind === 'failed' ? ` ${result.detail}` : '';
      this.deps.log(
        `[diagnosis] fix ${request.fix} on ${request.printerName ?? '(system)'} admin=${request.admin}: ${result.kind}${detail}`,
      );
      return fixOutcome(system.platform, request, result);
    } finally {
      this.isFixing = false;
    }
  }

  private async checkListed(
    printerName: string,
    check: DiagnosisCheckId,
    expected: PaperSize | null,
  ): Promise<CheckVerdict> {
    const { system, commands } = this.deps;
    const noted = <T extends { kind: string }>(facts: T): T => this.noteUnknown(printerName, check, facts);
    switch (check) {
      case 'spooler':
        return spoolerVerdict(noted(await system.spooler(printerName)), system.platform);
      case 'printer':
        return printerVerdict(
          noted(await system.printer(printerName)),
          system.platform,
          await this.canReinstall(printerName),
        );
      case 'usb':
        return usbVerdict(noted(await system.usb(printerName)), system.platform, await this.canReinstall(printerName));
      case 'queue':
        return queueVerdict(
          noted(await system.jobs(printerName)),
          system.platform,
          this.deps.submitted.windowsFor(printerName),
          this.deps.clock.now(),
        );
      case 'paper':
        return paperVerdict(
          expected === null ? null : await this.deps.driverPaper(printerName),
          expected,
          system.platform,
        );
      case 'commands':
        return commandsVerdict(
          commands === null ? null : await commands.effectiveCommandSet(printerName),
          system.platform,
        );
    }
  }

  private async run(request: DiagnosisFixRequest): Promise<ActionResult> {
    const { system } = this.deps;
    const { printerName, fix, admin } = request;
    if (fix === 'restart-spooler') {
      return system.restartSpooler();
    }
    if (printerName === null) {
      throw new Error(`Fix "${fix}" needs a printer`);
    }
    switch (fix) {
      case 'open-preferences':
        await this.deps.openPreferences(printerName);
        this.deps.forgetProfile(printerName);
        return { kind: 'done' };
      case 'reinstall-driver':
        if (this.deps.drivers === null) {
          throw new Error('Driver reinstall is not available in this build');
        }
        return this.deps.drivers.reinstall(printerName);
      case 'enable-printer':
        return system.enablePrinter(printerName, admin);
      case 'open-queue':
        return system.openQueue(printerName);
      case 'cancel-own-jobs':
        return this.cancelOwnJobs(printerName);
      case 'cancel-all-jobs':
        return system.cancelAllJobs(printerName);
      case 'set-driver-paper': {
        if (request.paper === null) {
          throw new Error('set-driver-paper needs the paper the printer is responsible for');
        }
        const result = await system.setDriverPaper(printerName, request.paper, admin);
        // 改没改成都重读：回滚了也可能和之前缓存的不一样。
        this.deps.forgetProfile(printerName);
        return result;
      }
      case 'feed':
      case 'calibrate':
        if (this.deps.commands === null) {
          throw new Error('Label commands are not available in this build');
        }
        return this.deps.commands.send(printerName, fix);
    }
  }

  /** 修的时候重新查队列、重新认哪些是本程序的：不信界面传来的任务编号（界面根本不传）。 */
  private async cancelOwnJobs(printerName: string): Promise<ActionResult> {
    const facts = await this.deps.system.jobs(printerName);
    if (facts.kind === 'unknown') {
      return { kind: 'failed', detail: '查不到打印队列' };
    }
    const { own } = summarizeQueue(facts, this.deps.submitted.windowsFor(printerName), this.deps.clock.now());
    if (own.length === 0) {
      return { kind: 'done', count: 0 };
    }
    return this.deps.system.cancelJobs(
      printerName,
      own.map((job) => job.id),
    );
  }

  /** 5c 说能不能重装；它出错按「不能」处理并写日志（只是少一个按钮，不影响检查本身）。 */
  private async canReinstall(printerName: string): Promise<boolean> {
    if (this.deps.drivers === null) {
      return false;
    }
    try {
      return await this.deps.drivers.canReinstall(printerName);
    } catch (error) {
      this.deps.log(`[diagnosis] cannot ask whether the driver of ${printerName} can be reinstalled: ${String(error)}`);
      return false;
    }
  }

  private logged(printerName: string, verdict: CheckVerdict): CheckVerdict {
    this.deps.log(`[diagnosis] ${printerName} ${verdict.check}: ${verdict.status} ${verdict.detail}`);
    return verdict;
  }

  /** 「查不到」的原因（英文）只在事实里、不进结论：写进日志，排查时能看到是超时、命令出错还是输出读不懂。 */
  private noteUnknown<T extends { kind: string }>(printerName: string, check: DiagnosisCheckId, facts: T): T {
    if (facts.kind === 'unknown' && 'reason' in facts) {
      this.deps.log(`[diagnosis] ${printerName} ${check} unknown: ${String(facts.reason)}`);
    }
    return facts;
  }
}
