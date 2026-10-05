/**
 * 一键诊断修复（设计第 7.2 节）：界面和主进程共用的检查项、修复项和结果。
 * 结论和按钮上的字都由主进程给（按平台说具体的系统名词），界面只负责展示、按顺序调用。
 */

/** 检查项，按执行顺序：后台打印服务排第一，它停了，后面几项都查不到。 */
export const DIAGNOSIS_CHECKS = ['spooler', 'printer', 'usb', 'queue', 'paper', 'commands'] as const;
export type DiagnosisCheckId = (typeof DIAGNOSIS_CHECKS)[number];

/** 主进程能执行的修复：界面经 IPC 请求，主进程再按平台、管理员策略和这台打印机核对一遍。 */
export const DIAGNOSIS_FIXES = [
  'open-preferences',
  'reinstall-driver',
  'restart-spooler',
  'enable-printer',
  'open-queue',
  'cancel-own-jobs',
  'cancel-all-jobs',
  'set-driver-paper',
  'feed',
  'calibrate',
] as const;
export type DiagnosisFixId = (typeof DIAGNOSIS_FIXES)[number];

/** 只在界面里发生的「修复」：改指令集用打印机页已有的指令集下拉（5a），不经过诊断的通道。 */
export const CHANGE_COMMAND_SET = 'change-command-set';
export type DiagnosisOfferId = DiagnosisFixId | typeof CHANGE_COMMAND_SET;

/**
 * pass：查到了，没问题；fail：查到了问题；warn：可能有问题；unknown：查不到；
 * skipped：这一项对这台不适用；action：要操作员动手确认（指令集：走一张纸看有没有出纸）。
 */
export type VerdictStatus = 'pass' | 'fail' | 'warn' | 'unknown' | 'skipped' | 'action';

/** 结论下面的一个按钮。 */
export interface FixOffer {
  id: DiagnosisOfferId;
  /** 按钮上的字；要管理员权限的以「（需要管理员权限）」结尾。 */
  label: string;
  /** 点了会弹系统的管理员确认（Windows 的 UAC、macOS 的管理员密码框）。 */
  admin: boolean;
}

/** 一项检查的结论。 */
export interface CheckVerdict {
  check: DiagnosisCheckId;
  status: VerdictStatus;
  /** 一句话结论，只说程序确知的事。 */
  detail: string;
  /** 下一步怎么做；没有时为 null。 */
  nextStep: string | null;
  fixes: FixOffer[];
}

/** 界面交给主进程的修复请求（主进程逐项校验，见 ipc-validators.ts 的 requireDiagnosisFixRequest）。 */
export interface FixRequest {
  /** null 只用于「重启后台打印服务」：系统列不出打印机的时候。 */
  printerName: string | null;
  fix: DiagnosisFixId;
  /** 点的是不是「（需要管理员权限）」的按钮。 */
  admin: boolean;
  /** 这台打印机负责的纸（纸张键，例如 60x40）；只有「自动设置驱动纸张」用，其余为 null。 */
  paperKey: string | null;
}

/**
 * 修复做了什么（不是「解决了没有」：解决没有由随后的重新检查说）。
 * needs-admin：以当前用户做被系统拒绝（macOS 的 CUPS），retry 是换上的管理员按钮。
 */
export type FixOutcome =
  | { status: 'done'; message: string }
  | { status: 'declined'; message: string }
  | { status: 'needs-admin'; message: string; retry: FixOffer }
  | { status: 'failed'; message: string }
  | { status: 'rolled-back'; message: string };

export const CHECK_TITLES: Readonly<Record<DiagnosisCheckId, string>> = {
  spooler: '后台打印服务',
  printer: '打印机和驱动状态',
  usb: 'USB 连接',
  queue: '打印队列',
  paper: '驱动纸张',
  commands: '指令集',
};

/** 修复做完（或回滚）后重查哪几项：只重查受影响的，其余结论留着。 */
export const RECHECK_AFTER: Readonly<Record<DiagnosisFixId, readonly DiagnosisCheckId[]>> = {
  'open-preferences': ['printer', 'paper'],
  'reinstall-driver': ['printer', 'usb', 'paper'],
  'restart-spooler': DIAGNOSIS_CHECKS,
  'enable-printer': ['spooler', 'printer'],
  'open-queue': ['printer', 'queue'],
  'cancel-own-jobs': ['queue'],
  'cancel-all-jobs': ['queue'],
  'set-driver-paper': ['paper'],
  // 走纸、校准的结果程序读不到：不重查，改问操作员（lib/diagnosis-view.ts）。
  feed: [],
  calibrate: [],
};

/** 只认自己的值：渲染进程传来的字符串可能是任何东西（包括 __proto__）。 */
export function isDiagnosisCheckId(value: unknown): value is DiagnosisCheckId {
  return typeof value === 'string' && (DIAGNOSIS_CHECKS as readonly string[]).includes(value);
}

export function isDiagnosisFixId(value: unknown): value is DiagnosisFixId {
  return typeof value === 'string' && (DIAGNOSIS_FIXES as readonly string[]).includes(value);
}
