import {
  CHANGE_COMMAND_SET,
  type CheckVerdict,
  type DiagnosisCheckId,
  type DiagnosisOfferId,
  type FixOffer,
  type VerdictStatus,
} from '../../shared/diagnosis';
import { type DriverPaper, formatPaperSize } from '../../shared/driver-paper';
import { isSamePaper, type PaperSize } from '../../shared/paper-sizes';
import type { PrinterIssue } from '../../shared/printer-readiness';
import type {
  CommandSetName,
  DiagnosisPlatform,
  PrinterFacts,
  QueueFacts,
  SpoolerFacts,
  UsbFacts,
} from './diagnosis-model';
import { offerFor } from './fixes';
import { STUCK_JOB_AGE_MS, summarizeQueue } from './queue-summary';
import type { SubmittedWindow } from './submitted-jobs';

const UNSUPPORTED_DETAIL = '这个系统不支持这一项检查';
/** 设备管理器里「没有安装驱动」的问题代码（CM_PROB_FAILED_INSTALL）。 */
const CM_PROB_FAILED_INSTALL = 28;
const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

const ISSUE_NEXT_STEPS: Readonly<Record<PrinterIssue, string>> = {
  paperOut: '装好标签纸、合上机盖；换了纸的话做一次纸张校准（最后一项）',
  paperJam: '打开机盖，取出卡住的标签，重新装好纸',
  doorOpen: '把机盖合上（听到咔哒一声）',
  offline: '检查标签机电源和数据线；USB 连接的看下一项',
  other: '按标签机面板上的指示灯处理；还不行就重新安装驱动',
};

const USB_NEXT_STEPS: Readonly<Record<'windows' | 'mac', string>> = {
  windows:
    '确认标签机开着；拔掉 USB 线等几秒再插上，或换一个 USB 口、换一根线。换口后 Windows 可能把它当成新的打印机（端口变成 USB002 这样），回来点「重新检查」',
  mac: '确认标签机开着；拔掉 USB 线等几秒再插上，或换一个 USB 口、换一根线，再点「重新检查」',
};

function verdict(
  check: DiagnosisCheckId,
  status: VerdictStatus,
  detail: string,
  nextStep: string | null,
  fixes: FixOffer[],
): CheckVerdict {
  return { check, status, detail, nextStep, fixes };
}

/** 这个系统上有的修复才给按钮（例如 macOS 没有「打开打印队列」）。 */
function offers(platform: DiagnosisPlatform, ...ids: DiagnosisOfferId[]): FixOffer[] {
  return ids.flatMap((id) => {
    const offer = offerFor(platform, id);
    return offer === null ? [] : [offer];
  });
}

function unknownVerdict(
  check: DiagnosisCheckId,
  platform: DiagnosisPlatform,
  detail: string,
  fixes: FixOffer[] = [],
): CheckVerdict {
  return platform === 'other'
    ? verdict(check, 'unknown', UNSUPPORTED_DETAIL, null, [])
    : verdict(check, 'unknown', detail, null, fixes);
}

/** 等了多久：取能放下的最大整单位（不足一分钟说秒）。 */
export function formatAge(ms: number): string {
  const seconds = Math.floor(ms / MS_PER_SECOND);
  if (seconds < SECONDS_PER_MINUTE) {
    return `${seconds} 秒`;
  }
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  return minutes < MINUTES_PER_HOUR ? `${minutes} 分钟` : `${Math.floor(minutes / MINUTES_PER_HOUR)} 小时`;
}

/** 后台打印服务：Windows 的 Spooler；macOS 的 CUPS 和这台打印机在 CUPS 里的启用状态。 */
export function spoolerVerdict(facts: SpoolerFacts, platform: DiagnosisPlatform): CheckVerdict {
  const restart = offers(platform, 'restart-spooler');
  switch (facts.kind) {
    case 'unknown':
      return unknownVerdict('spooler', platform, '查不到后台打印服务的状态');
    case 'windows':
      if (facts.state === 'running') {
        return verdict('spooler', 'pass', '后台打印服务（Print Spooler）在运行', null, []);
      }
      if (facts.startType === 'disabled') {
        return verdict(
          'spooler',
          'fail',
          '后台打印服务被禁用了：所有打印都发不出去',
          '点「重启后台打印服务」，会把它设为自动并启动；公司电脑上如果是管理员有意禁用的，先问管理员',
          restart,
        );
      }
      if (facts.state === 'stopped') {
        return verdict(
          'spooler',
          'fail',
          '后台打印服务没有运行：所有打印都发不出去',
          '点「重启后台打印服务」，Windows 会弹一次管理员确认',
          restart,
        );
      }
      return verdict(
        'spooler',
        'warn',
        facts.state === 'pending' ? '后台打印服务正在启动或停止' : '后台打印服务处在不常见的状态',
        '等几秒点「重新检查」；一直这样就重启它',
        restart,
      );
    case 'mac':
      if (!facts.schedulerRunning) {
        return verdict(
          'spooler',
          'fail',
          '打印系统（CUPS）没有在运行：所有打印都发不出去',
          '点「重启打印系统」，按提示输入管理员密码',
          restart,
        );
      }
      if (facts.queue === null) {
        return verdict('spooler', 'pass', '打印系统（CUPS）在运行', null, []);
      }
      if (!facts.queue.enabled) {
        return verdict(
          'spooler',
          'fail',
          '这台打印机在系统里被暂停了：任务只进队列、不打印',
          '点「恢复这台打印机」',
          offers(platform, 'enable-printer'),
        );
      }
      if (!facts.queue.acceptingJobs) {
        return verdict(
          'spooler',
          'fail',
          '这台打印机在系统里设成了「拒收任务」：新任务发不进去',
          '点「恢复这台打印机」',
          offers(platform, 'enable-printer'),
        );
      }
      return verdict('spooler', 'pass', '打印系统（CUPS）在运行，这台打印机已启用、接收任务', null, []);
  }
}

/** 驱动（或 CUPS）报告的状态。canReinstallDriver：5c 的接缝说能重装这台的驱动。 */
export function printerVerdict(
  facts: PrinterFacts,
  platform: DiagnosisPlatform,
  canReinstallDriver: boolean,
): CheckVerdict {
  if (facts.kind === 'unknown') {
    return unknownVerdict('printer', platform, '查不到驱动报告的状态', offers(platform, 'open-preferences'));
  }
  if (facts.paused) {
    return verdict(
      'printer',
      'fail',
      '打印机在系统里被暂停了：任务只进队列、不打印',
      '点「打开打印队列」，在「打印机」菜单里取消勾选「暂停打印」',
      offers(platform, 'open-queue'),
    );
  }
  const { readiness } = facts;
  if (readiness.ready) {
    const driver = facts.driverName === null ? '' : `（驱动：${facts.driverName}）`;
    return verdict('printer', 'pass', `驱动没有报告问题${driver}`, null, []);
  }
  const mayNeedDriver = canReinstallDriver && (readiness.issue === 'other' || readiness.issue === 'offline');
  return verdict(
    'printer',
    'fail',
    `驱动报告：${readiness.detail}`,
    ISSUE_NEXT_STEPS[readiness.issue],
    offers(platform, 'open-preferences', ...(mayNeedDriver ? (['reinstall-driver'] as const) : [])),
  );
}

export function usbVerdict(facts: UsbFacts, platform: DiagnosisPlatform, canReinstallDriver: boolean): CheckVerdict {
  const cable = platform === 'other' ? null : USB_NEXT_STEPS[platform];
  switch (facts.kind) {
    case 'unknown':
      return unknownVerdict('usb', platform, '查不到 USB 设备');
    case 'not-usb':
      return verdict(
        'usb',
        'skipped',
        `这台打印机的连接方式是 ${facts.port}，不是系统的 USB 端口，这一项不适用`,
        null,
        [],
      );
    case 'present':
      return verdict('usb', 'pass', `系统能看到它的 USB 设备（${facts.deviceName}）`, null, []);
    case 'disconnected':
      return verdict('usb', 'fail', `系统记得它的 USB 设备（${facts.deviceName}），但现在没连上`, cable, []);
    case 'not-found':
      return verdict('usb', 'warn', `没找到端口 ${facts.port} 对应的 USB 设备`, cable, []);
    case 'problem':
      if (facts.code === CM_PROB_FAILED_INSTALL) {
        return verdict(
          'usb',
          'fail',
          `它的 USB 设备（${facts.deviceName}）没有装驱动`,
          canReinstallDriver
            ? '点「重新安装驱动」'
            : '到标签机厂家的官网下载驱动装上，或在「设备管理器」里更新这个设备的驱动',
          canReinstallDriver ? offers(platform, 'reinstall-driver') : [],
        );
      }
      return verdict(
        'usb',
        'fail',
        `系统报告它的 USB 设备（${facts.deviceName}）有问题（代码 ${facts.code}）`,
        cable,
        [],
      );
  }
}

export function queueVerdict(
  facts: QueueFacts,
  platform: DiagnosisPlatform,
  windows: readonly SubmittedWindow[],
  nowMs: number,
): CheckVerdict {
  if (facts.kind === 'unknown') {
    return unknownVerdict('queue', platform, '查不到打印队列');
  }
  const summary = summarizeQueue(facts, windows, nowMs);
  if (summary.total === 0) {
    return verdict('queue', 'pass', '队列是空的', null, []);
  }
  const partial = summary.total > summary.listed ? `（只看了前 ${summary.listed} 个）` : '';
  if (summary.stuck === 0) {
    return verdict(
      'queue',
      'pass',
      `队列里有 ${summary.total} 个任务，都还不到 ${formatAge(STUCK_JOB_AGE_MS)}，驱动也没有报错${partial}`,
      null,
      [],
    );
  }
  // ownStuck 为 0 时不能说「都不是本程序发的」：账本只在内存里、最多保留一天，重启或时间久了
  // 就认不出哪些是本程序发的，那不代表真的都不是；只有认出是本程序发的才能肯定地说。
  const own =
    summary.ownStuck === summary.stuck
      ? '都是本程序发的'
      : summary.ownStuck === 0
        ? '认不出是本程序发的'
        : `其中 ${summary.ownStuck} 个是本程序发的`;
  const waited = formatAge(summary.oldestStuckAgeMs ?? 0);
  return verdict(
    'queue',
    'fail',
    `有 ${summary.stuck} 个任务卡在队列里（最早的已经等了 ${waited}），${own}${partial}`,
    '卡住的任务会挡住后面的标签：先处理上面几项的问题（缺纸、离线），再清掉卡住的任务',
    offers(
      platform,
      ...(summary.own.length > 0 ? (['cancel-own-jobs'] as const) : []),
      'cancel-all-jobs',
      'open-queue',
    ),
  );
}

/** expected 为 null：这台打印机没有负责的纸张（没被分配），不核对。 */
export function paperVerdict(
  paper: DriverPaper | null,
  expected: PaperSize | null,
  platform: DiagnosisPlatform,
): CheckVerdict {
  if (expected === null) {
    return verdict('paper', 'skipped', '这台打印机没有负责的纸张，不用核对', null, []);
  }
  if (paper === null) {
    return unknownVerdict('paper', platform, '读不到驱动的默认纸张', offers(platform, 'open-preferences'));
  }
  if (isSamePaper(paper, expected)) {
    return verdict(
      'paper',
      'pass',
      `驱动纸张 ${formatPaperSize(paper)}，和它负责的 ${formatPaperSize(expected)} 一致`,
      null,
      [],
    );
  }
  return verdict(
    'paper',
    'fail',
    `驱动纸张是 ${formatPaperSize(paper)}，它负责的是 ${formatPaperSize(expected)}：打出来可能缩放、跳纸或出空白标签`,
    '点「自动设置驱动纸张」；不行就打开打印首选项手动改',
    offers(platform, 'set-driver-paper', 'open-preferences'),
  );
}

/** commandSet 为 null：这一版没有 5a 的接缝。 */
export function commandsVerdict(commandSet: CommandSetName | 'none' | null, platform: DiagnosisPlatform): CheckVerdict {
  if (commandSet === null) {
    return verdict('commands', 'skipped', '这一版还不能给标签机发指令', null, []);
  }
  if (commandSet === 'none') {
    return verdict(
      'commands',
      'skipped',
      '指令集设成了「不发指令」，或认不出这台的指令集：程序不给它发指令',
      null,
      offers(platform, CHANGE_COMMAND_SET),
    );
  }
  return verdict(
    'commands',
    'action',
    `指令集：${commandSet.toUpperCase()}。指令是单向的，程序读不到标签机的回答`,
    '点「走一张纸」，看标签机有没有走出一张空白标签',
    offers(platform, 'feed', 'calibrate', CHANGE_COMMAND_SET),
  );
}

/** 打印机在点「诊断」之后离开了系统列表（拔掉、被删）：不交给任何系统命令，只说清楚。 */
export function missingPrinterVerdict(check: DiagnosisCheckId): CheckVerdict {
  return verdict(
    check,
    'fail',
    '系统打印机列表里已经没有这台了',
    '确认标签机开着、线插好，在系统设置里看它还在不在，再回来点「刷新」',
    [],
  );
}
