import {
  CHANGE_COMMAND_SET,
  type DiagnosisFixId,
  type DiagnosisOfferId,
  type FixOffer,
  type FixOutcome,
} from '../../shared/diagnosis';
import { formatPaperSize } from '../../shared/driver-paper';
import type { PaperSize } from '../../shared/paper-sizes';
import type { ActionResult, DiagnosisFixRequest, DiagnosisPlatform } from './diagnosis-model';

/**
 * always：一定弹管理员确认；optional：先以当前用户做，系统拒绝时再换成管理员按钮（macOS 的 CUPS：
 * 管理员组的用户本来就能改，普通用户才要密码）；never：不要管理员；unsupported：这个系统上没有这个修复。
 */
export type AdminPolicy = 'always' | 'optional' | 'never' | 'unsupported';

const WINDOWS_POLICY: Readonly<Record<DiagnosisFixId, AdminPolicy>> = {
  'open-preferences': 'never',
  'reinstall-driver': 'always',
  'restart-spooler': 'always',
  'enable-printer': 'unsupported',
  'open-queue': 'never',
  'cancel-own-jobs': 'never',
  // 别人的任务（包括别的账户的）要「管理文档」权限；一律按管理员做，不猜队列里是谁的。
  'cancel-all-jobs': 'always',
  // 改的是打印机的默认设置（DefaultPrintTicket），要「管理打印机」权限。
  'set-driver-paper': 'always',
  feed: 'never',
  calibrate: 'never',
};

const MAC_POLICY: Readonly<Record<DiagnosisFixId, AdminPolicy>> = {
  'open-preferences': 'never',
  'reinstall-driver': 'always',
  // cupsd 由 launchd 管，重启要 root。
  'restart-spooler': 'always',
  'enable-printer': 'optional',
  'open-queue': 'unsupported',
  'cancel-own-jobs': 'never',
  'cancel-all-jobs': 'always',
  'set-driver-paper': 'optional',
  feed: 'never',
  calibrate: 'never',
};

export function adminPolicy(platform: DiagnosisPlatform, fix: DiagnosisFixId): AdminPolicy {
  switch (platform) {
    case 'windows':
      return WINDOWS_POLICY[fix];
    case 'mac':
      return MAC_POLICY[fix];
    case 'other':
      return 'unsupported';
  }
}

/** 要管理员权限的按钮统一加这一句：Windows 弹 UAC、macOS 弹管理员密码框，两边都是「管理员权限」。 */
const ADMIN_SUFFIX = '（需要管理员权限）';

const LABELS: Readonly<Record<DiagnosisOfferId, string>> = {
  'open-preferences': '打开打印首选项',
  'reinstall-driver': '重新安装驱动',
  'restart-spooler': '重启后台打印服务',
  'enable-printer': '恢复这台打印机',
  'open-queue': '打开打印队列',
  'cancel-own-jobs': '清除本程序的任务',
  'cancel-all-jobs': '清除全部任务',
  'set-driver-paper': '自动设置驱动纸张',
  feed: '走一张纸',
  calibrate: '纸张校准',
  [CHANGE_COMMAND_SET]: '改指令集',
};

function labelOf(platform: DiagnosisPlatform, id: DiagnosisOfferId): string {
  // macOS 没有叫「后台打印服务」的东西：说它真正的名字。
  return platform === 'mac' && id === 'restart-spooler' ? '重启打印系统' : LABELS[id];
}

/**
 * 结论下面的按钮；这个系统上没有的修复返回 null。
 * admin 只对 optional 的修复有意义：false 是先以当前用户做的按钮，true 是系统拒绝后换上的管理员按钮。
 */
export function offerFor(platform: DiagnosisPlatform, id: DiagnosisOfferId, admin = false): FixOffer | null {
  if (id === CHANGE_COMMAND_SET) {
    return { id, label: LABELS[id], admin: false };
  }
  const policy = adminPolicy(platform, id);
  if (policy === 'unsupported') {
    return null;
  }
  const isAdmin = policy === 'always' || (policy === 'optional' && admin);
  return { id, label: `${labelOf(platform, id)}${isAdmin ? ADMIN_SUFFIX : ''}`, admin: isAdmin };
}

const DECLINED_MESSAGE = '没有拿到管理员权限（确认框里选了「否」或关掉了），什么都没改';
const NEEDS_ADMIN_MESSAGE = '系统要求管理员权限才能做这一步：点下面换上的按钮，按提示确认';
const ROLLED_BACK_MESSAGE = '设置之后回读的纸张不对，已恢复原来的设置：打开打印首选项手动改';

function paperText(paper: PaperSize | null): string {
  return paper === null ? '这种纸' : formatPaperSize(paper);
}

function doneMessage(platform: DiagnosisPlatform, request: DiagnosisFixRequest, count: number | null): string {
  switch (request.fix) {
    case 'open-preferences':
      // Windows 的「打印首选项」关掉才返回；macOS 打开系统设置就返回，改完要操作员自己回来重查。
      return platform === 'mac'
        ? '已打开「打印机与扫描仪」：改完回到程序，点「重新检查」'
        : '打印首选项已关闭，正在重新检查';
    case 'reinstall-driver':
      return '驱动已重新安装，正在重新检查';
    case 'restart-spooler':
      return platform === 'mac' ? '已请求重启打印系统' : '后台打印服务已重新启动';
    case 'enable-printer':
      return '已请求恢复这台打印机';
    case 'open-queue':
      return '打印队列窗口已关闭，正在重新检查';
    case 'cancel-own-jobs':
      return count === null || count === 0 ? '队列里已经没有本程序的任务' : `已请求取消本程序的 ${count} 个任务`;
    case 'cancel-all-jobs':
      return '已请求清空这台打印机的队列';
    case 'set-driver-paper':
      return `驱动默认纸张已设为 ${paperText(request.paper)}`;
    case 'feed':
      return '走纸指令已发送（进了打印队列）';
    case 'calibrate':
      return '校准指令已发送（进了打印队列）';
  }
}

/** 动作结果 → 给操作员看的话。needs-admin 附上换上的管理员按钮；这个修复没有管理员版本时是程序错误，直接抛。 */
export function fixOutcome(
  platform: DiagnosisPlatform,
  request: DiagnosisFixRequest,
  result: ActionResult,
): FixOutcome {
  switch (result.kind) {
    case 'done':
      return { status: 'done', message: doneMessage(platform, request, result.count ?? null) };
    case 'declined':
      return { status: 'declined', message: DECLINED_MESSAGE };
    case 'needs-admin': {
      const retry = offerFor(platform, request.fix, true);
      if (retry === null || !retry.admin) {
        throw new Error(`Fix "${request.fix}" has no admin variant on ${platform}`);
      }
      return { status: 'needs-admin', message: NEEDS_ADMIN_MESSAGE, retry };
    }
    case 'rolled-back':
      return { status: 'rolled-back', message: ROLLED_BACK_MESSAGE };
    case 'no-matching-paper':
      return {
        status: 'failed',
        message: `驱动里没有 ${paperText(request.paper)} 这种纸，也不能自定义尺寸：打开打印首选项，新建这种纸再选上`,
      };
    case 'failed':
      return { status: 'failed', message: `没做成：${result.detail}` };
  }
}
