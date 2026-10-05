import type { DiagnosisFixId } from '../../shared/diagnosis';
import type { PaperSize } from '../../shared/paper-sizes';
import type { PrinterReadiness } from '../../shared/printer-readiness';

/** 诊断按哪个系统说话：命令、名词、能做的修复都不一样。other = 这个系统不支持诊断。 */
export type DiagnosisPlatform = 'windows' | 'mac' | 'other';

/** 查不到：reason 是英文，写日志给开发者看；界面统一说「查不到」。 */
export interface UnknownFacts {
  kind: 'unknown';
  reason: string;
}

/** macOS 上这台打印机在 CUPS 里是否启用、是否接收任务。 */
export interface MacQueueState {
  enabled: boolean;
  acceptingJobs: boolean;
}

/** 后台打印服务：Windows 的 Spooler 服务；macOS 的 CUPS 调度程序（和这台打印机在 CUPS 里的启用状态）。 */
export type SpoolerFacts =
  | {
      kind: 'windows';
      state: 'running' | 'stopped' | 'pending' | 'other';
      startType: 'automatic' | 'manual' | 'disabled' | 'other';
    }
  | { kind: 'mac'; schedulerRunning: boolean; queue: MacQueueState | null }
  | UnknownFacts;

/** 驱动（或 CUPS）报告的这台打印机的状态。paused：Windows 上打印机被设成「暂停打印」。 */
export type PrinterFacts =
  | { kind: 'known'; readiness: PrinterReadiness; paused: boolean; driverName: string | null }
  | UnknownFacts;

/**
 * USB：present 系统能看到它的 USB 设备；disconnected 系统记得这个设备但现在没连上；
 * problem 设备在但系统报告问题（Windows 设备管理器的问题代码）；not-found 是 USB 端口但找不到对应设备；
 * not-usb 不是 USB 连接（网络、蓝牙或厂家自己的端口），这一项不适用。
 */
export type UsbFacts =
  | { kind: 'present'; deviceName: string }
  | { kind: 'disconnected'; deviceName: string }
  | { kind: 'problem'; deviceName: string; code: number }
  | { kind: 'not-found'; port: string }
  | { kind: 'not-usb'; port: string }
  | UnknownFacts;

export const JOB_FLAGS = [
  'error',
  'paused',
  'offline',
  'paper-out',
  'blocked',
  'user-intervention',
  'held',
  'stopped',
  'printing',
] as const;
/** 任务状态，两个平台统一成这几种（Windows 的 JobStatus、CUPS 的 job-state / job-state-reasons）。 */
export type JobFlag = (typeof JOB_FLAGS)[number];

/** 队列里的一个任务。 */
export interface QueueJob {
  id: number;
  /** 文档名（本程序发的是标签内容），只用来写日志。 */
  document: string;
  user: string;
  submittedAtMs: number;
  flags: JobFlag[];
}

/** total 是队列里的总数；jobs 最多 DIAGNOSIS_LIMITS.jobs 个。 */
export type QueueFacts = { kind: 'listed'; currentUser: string; total: number; jobs: QueueJob[] } | UnknownFacts;

/** 5a 的三种指令集。 */
export type CommandSetName = 'tspl' | 'zpl' | 'epl';

/**
 * 一个修复动作的结果。done 只说明系统命令做完了；needs-admin：以当前用户做被系统拒绝；
 * no-matching-paper：驱动里没有这种纸，也不能自定义（没有弹管理员确认）；rolled-back：改了但回读不对，已恢复。
 */
export type ActionResult =
  | { kind: 'done'; count?: number }
  | { kind: 'declined' }
  | { kind: 'needs-admin' }
  | { kind: 'rolled-back' }
  | { kind: 'no-matching-paper' }
  | { kind: 'failed'; detail: string };

/** 主进程校验过的修复请求（paperKey 已换成纸张）。 */
export interface DiagnosisFixRequest {
  printerName: string | null;
  fix: DiagnosisFixId;
  admin: boolean;
  paper: PaperSize | null;
}

/** 系统命令输出的上限：输出不可信（打印机名、文档名来自别的程序），条数和字数都限住。 */
export const DIAGNOSIS_LIMITS = {
  /** 队列里最多看 100 个任务：标签机的队列正常时是空的，100 个足够说明「堵住了」。 */
  jobs: 100,
  /** USB 打印设备最多看 50 个：一台电脑接过的打印机不会更多。 */
  usbDevices: 50,
  /** 驱动纸张选项最多看 200 种：热敏标签机驱动常带几十到一百多种预设。 */
  paperOptions: 200,
  /** 文字字段（文档名、设备名、驱动名）最多 200 个字符：只用来显示和写日志。 */
  textLength: 200,
} as const;
