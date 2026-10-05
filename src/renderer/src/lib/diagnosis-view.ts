import {
  CHANGE_COMMAND_SET,
  type CheckVerdict,
  DIAGNOSIS_CHECKS,
  type DiagnosisCheckId,
  type DiagnosisFixId,
  type FixOffer,
  type FixOutcome,
  RECHECK_AFTER,
  type VerdictStatus,
} from '../../../shared/diagnosis';

/** 指令集一项：走纸之后问操作员（none 还没走纸；asking 在问；works 出了纸；silent 没反应）。 */
export type FeedAnswer = 'none' | 'asking' | 'works' | 'silent';

/** 一项检查在面板上的样子。 */
export interface DiagnosisItem {
  check: DiagnosisCheckId;
  phase: 'waiting' | 'checking' | 'done';
  verdict: CheckVerdict | null;
  /** 最近一次修复的结果（「已请求取消 2 个任务」「没有拿到管理员权限」）。 */
  outcome: FixOutcome | null;
  /** 系统要求管理员时换上的按钮（needs-admin 的 retry）。 */
  adminRetry: FixOffer | null;
  feed: FeedAnswer;
  /** 在这一项下面显示指令集下拉。 */
  isPickingCommandSet: boolean;
}

export interface DiagnosisView {
  /** null = 只查后台打印服务（系统列不出打印机的时候）。 */
  printerName: string | null;
  /** 这台打印机负责的纸；没有时为 null。 */
  paperKey: string | null;
  items: DiagnosisItem[];
  /** 正在做的修复（同一时间只做一个）。 */
  busyFix: DiagnosisFixId | null;
}

export type BadgeTone = 'ok' | 'warning' | 'error' | 'quiet';

export const STATUS_BADGES: Readonly<Record<VerdictStatus, { text: string; tone: BadgeTone }>> = {
  pass: { text: '通过', tone: 'ok' },
  fail: { text: '有问题', tone: 'error' },
  warn: { text: '注意', tone: 'warning' },
  unknown: { text: '查不到', tone: 'quiet' },
  skipped: { text: '跳过', tone: 'quiet' },
  action: { text: '待确认', tone: 'warning' },
};

const WORKS_DETAIL = '操作员确认：标签机走出了空白标签，指令集能通信';
const SILENT_DETAIL = '标签机没有反应：指令集可能不对，或者标签机没收到指令';
const SILENT_NEXT_STEP = '换一个指令集，再点「走一张纸」；还不行就看上面几项（驱动状态、USB、队列）';

function newItem(check: DiagnosisCheckId): DiagnosisItem {
  return {
    check,
    phase: 'waiting',
    verdict: null,
    outcome: null,
    adminRetry: null,
    feed: 'none',
    isPickingCommandSet: false,
  };
}

function mapItem(
  view: DiagnosisView,
  check: DiagnosisCheckId,
  change: (item: DiagnosisItem) => DiagnosisItem,
): DiagnosisView {
  return { ...view, items: view.items.map((item) => (item.check === check ? change(item) : item)) };
}

/** 新的一轮：打印机的六项；只查后台打印服务时只有一项。 */
export function startDiagnosis(printerName: string | null, paperKey: string | null): DiagnosisView {
  const checks: readonly DiagnosisCheckId[] = printerName === null ? ['spooler'] : DIAGNOSIS_CHECKS;
  return { printerName, paperKey, items: checks.map(newItem), busyFix: null };
}

export function withChecking(view: DiagnosisView, check: DiagnosisCheckId): DiagnosisView {
  return mapItem(view, check, (item) => ({ ...item, phase: 'checking' }));
}

/** 拿到结论。指令集重查之后，之前问过的「出纸了吗」作废。 */
export function withVerdict(view: DiagnosisView, verdict: CheckVerdict): DiagnosisView {
  return mapItem(view, verdict.check, (item) => ({
    ...item,
    phase: 'done',
    verdict,
    adminRetry: null,
    feed: verdict.check === 'commands' ? 'none' : item.feed,
  }));
}

/** 修复做完要重查的几项：排回「等待」，旧结论去掉（修复的结果留着）。 */
export function withRequeued(view: DiagnosisView, checks: readonly DiagnosisCheckId[]): DiagnosisView {
  return {
    ...view,
    items: view.items.map((item) =>
      checks.includes(item.check) ? { ...item, phase: 'waiting', verdict: null } : item,
    ),
  };
}

export function withFixStarted(view: DiagnosisView, fix: DiagnosisFixId): DiagnosisView {
  return { ...view, busyFix: fix };
}

/** 修复结束：结果写在那一项下面；系统要管理员时换按钮；走纸发出去了就问操作员。 */
export function withFixOutcome(
  view: DiagnosisView,
  check: DiagnosisCheckId,
  fix: DiagnosisFixId,
  outcome: FixOutcome,
): DiagnosisView {
  const next = mapItem(view, check, (item) => ({
    ...item,
    outcome,
    adminRetry: outcome.status === 'needs-admin' ? outcome.retry : null,
    feed: fix === 'feed' && outcome.status === 'done' ? 'asking' : item.feed,
  }));
  return { ...next, busyFix: null };
}

/** 操作员回答走纸后有没有出纸；没出纸就直接打开指令集下拉。 */
export function withFeedAnswer(view: DiagnosisView, works: boolean): DiagnosisView {
  return mapItem(view, 'commands', (item) => ({
    ...item,
    feed: works ? 'works' : 'silent',
    isPickingCommandSet: !works,
  }));
}

export function withCommandSetPicker(view: DiagnosisView): DiagnosisView {
  return mapItem(view, 'commands', (item) => ({ ...item, isPickingCommandSet: true }));
}

/** 修复之后重查哪几项（只取这个面板里有的）。 */
export function checksAfterFix(view: DiagnosisView, fix: DiagnosisFixId): DiagnosisCheckId[] {
  return RECHECK_AFTER[fix].filter((check) => view.items.some((item) => item.check === check));
}

/** 显示的结论：指令集一项按操作员的回答改写（程序自己读不到标签机的回答）。 */
export function shownVerdict(item: DiagnosisItem): CheckVerdict | null {
  const { verdict } = item;
  if (verdict === null || item.check !== 'commands') {
    return verdict;
  }
  if (item.feed === 'works') {
    return {
      ...verdict,
      status: 'pass',
      detail: WORKS_DETAIL,
      nextStep: null,
      fixes: verdict.fixes.filter((fix) => fix.id === 'calibrate'),
    };
  }
  if (item.feed === 'silent') {
    return {
      ...verdict,
      status: 'fail',
      detail: SILENT_DETAIL,
      nextStep: SILENT_NEXT_STEP,
      fixes: verdict.fixes.filter((fix) => fix.id === 'feed' || fix.id === CHANGE_COMMAND_SET),
    };
  }
  return verdict;
}

/** 显示的按钮：系统要管理员时，同一个修复换成管理员按钮。 */
export function shownOffers(item: DiagnosisItem): FixOffer[] {
  const offers = shownVerdict(item)?.fixes ?? [];
  const retry = item.adminRetry;
  return retry === null ? offers : offers.map((offer) => (offer.id === retry.id ? retry : offer));
}

export function itemBadge(item: DiagnosisItem): { text: string; tone: BadgeTone } {
  if (item.phase === 'checking') {
    return { text: '正在查…', tone: 'quiet' };
  }
  const verdict = shownVerdict(item);
  return verdict === null ? { text: '等待', tone: 'quiet' } : STATUS_BADGES[verdict.status];
}

/** 面板顶部的一句话：进度，或查完后有几项有问题、查不到、待确认。 */
export function diagnosisSummary(view: DiagnosisView): string {
  const total = view.items.length;
  const done = view.items.filter((item) => item.phase === 'done').length;
  if (done < total) {
    return `正在检查（${done}/${total}）…`;
  }
  const statuses = view.items.map((item) => shownVerdict(item)?.status);
  const count = (wanted: readonly VerdictStatus[]) =>
    statuses.filter((status) => status !== undefined && wanted.includes(status)).length;
  const problems = count(['fail', 'warn']);
  const parts = [problems === 0 ? '查完了：没发现问题' : `查完了：${problems} 项有问题`];
  const unknown = count(['unknown']);
  const waiting = count(['action']);
  if (unknown > 0) {
    parts.push(`${unknown} 项查不到`);
  }
  if (waiting > 0) {
    parts.push(`${waiting} 项待确认`);
  }
  return parts.join('，');
}
