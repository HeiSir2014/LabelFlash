import { describe, expect, test } from 'bun:test';
import type { QueueJob } from './diagnosis-model';
import {
  commandsVerdict,
  formatAge,
  missingPrinterVerdict,
  paperVerdict,
  printerVerdict,
  queueVerdict,
  spoolerVerdict,
  usbVerdict,
} from './verdicts';

const NOW = 1_790_000_000_000;
const LABEL = { widthMm: 60, heightMm: 40 };
const ids = (fixes: { id: string }[]) => fixes.map((fix) => fix.id);

describe('spoolerVerdict', () => {
  test('Windows: running passes, stopped or disabled offers an admin restart', () => {
    expect(spoolerVerdict({ kind: 'windows', state: 'running', startType: 'automatic' }, 'windows')).toMatchObject({
      status: 'pass',
      detail: '后台打印服务（Print Spooler）在运行',
    });
    const disabled = spoolerVerdict({ kind: 'windows', state: 'stopped', startType: 'disabled' }, 'windows');
    expect(disabled).toMatchObject({ status: 'fail', detail: '后台打印服务被禁用了：所有打印都发不出去' });
    expect(disabled.fixes).toEqual([
      { id: 'restart-spooler', label: '重启后台打印服务（需要管理员权限）', admin: true },
    ]);
  });

  test('macOS: a paused printer is restored as the current user first', () => {
    const paused = spoolerVerdict(
      { kind: 'mac', schedulerRunning: true, queue: { enabled: false, acceptingJobs: true } },
      'mac',
    );
    expect(paused).toMatchObject({ status: 'fail', detail: '这台打印机在系统里被暂停了：任务只进队列、不打印' });
    expect(paused.fixes).toEqual([{ id: 'enable-printer', label: '恢复这台打印机', admin: false }]);
    expect(spoolerVerdict({ kind: 'mac', schedulerRunning: false, queue: null }, 'mac').fixes[0]?.label).toBe(
      '重启打印系统（需要管理员权限）',
    );
  });

  test('says it cannot tell instead of guessing', () => {
    expect(spoolerVerdict({ kind: 'unknown', reason: 'probe failed' }, 'windows')).toMatchObject({
      status: 'unknown',
      detail: '查不到后台打印服务的状态',
    });
    expect(spoolerVerdict({ kind: 'unknown', reason: 'linux' }, 'other').detail).toBe('这个系统不支持这一项检查');
  });
});

describe('printerVerdict', () => {
  test('only says the driver reported no problem', () => {
    expect(
      printerVerdict(
        { kind: 'known', readiness: { ready: true }, paused: false, driverName: '热敏标签机驱动' },
        'windows',
        false,
      ),
    ).toMatchObject({ status: 'pass', detail: '驱动没有报告问题（驱动：热敏标签机驱动）' });
  });

  test('tells the operator what to do for the reported problem', () => {
    const paperOut = printerVerdict(
      {
        kind: 'known',
        readiness: { ready: false, detail: '缺纸', issue: 'paperOut' },
        paused: false,
        driverName: null,
      },
      'windows',
      false,
    );
    expect(paperOut).toMatchObject({ status: 'fail', detail: '驱动报告：缺纸' });
    expect(paperOut.nextStep).toContain('装好标签纸');
    expect(ids(paperOut.fixes)).toEqual(['open-preferences']);
  });

  test('offers a driver reinstall only when 5c can do it', () => {
    const facts = {
      kind: 'known' as const,
      readiness: { ready: false as const, detail: '打印机报错', issue: 'other' as const },
      paused: false,
      driverName: null,
    };
    expect(ids(printerVerdict(facts, 'windows', true).fixes)).toEqual(['open-preferences', 'reinstall-driver']);
    expect(ids(printerVerdict(facts, 'windows', false).fixes)).toEqual(['open-preferences']);
  });

  test('a paused Windows printer is resumed from the queue window', () => {
    const paused = printerVerdict(
      {
        kind: 'known',
        readiness: { ready: false, detail: '打印机已暂停', issue: 'other' },
        paused: true,
        driverName: null,
      },
      'windows',
      false,
    );
    expect(ids(paused.fixes)).toEqual(['open-queue']);
  });
});

describe('usbVerdict', () => {
  test('passes when the system sees the device and advises the cable when it does not', () => {
    expect(usbVerdict({ kind: 'present', deviceName: '热敏标签机' }, 'windows', false)).toMatchObject({
      status: 'pass',
      detail: '系统能看到它的 USB 设备（热敏标签机）',
    });
    const gone = usbVerdict({ kind: 'disconnected', deviceName: '热敏标签机' }, 'windows', false);
    expect(gone.status).toBe('fail');
    expect(gone.nextStep).toContain('换一个 USB 口');
  });

  test('a device without a driver is a reinstall when 5c is there', () => {
    const noDriver = usbVerdict({ kind: 'problem', deviceName: '热敏标签机', code: 28 }, 'windows', true);
    expect(noDriver.detail).toBe('它的 USB 设备（热敏标签机）没有装驱动');
    expect(ids(noDriver.fixes)).toEqual(['reinstall-driver']);
  });

  test('skips printers that are not on a system USB port', () => {
    expect(usbVerdict({ kind: 'not-usb', port: 'WSD-1' }, 'windows', false)).toMatchObject({ status: 'skipped' });
  });
});

describe('queueVerdict', () => {
  const job = (overrides: Partial<QueueJob>): QueueJob => ({
    id: 1,
    document: 'CL5640',
    user: 'shop',
    submittedAtMs: NOW - 300_000,
    flags: ['error'],
    ...overrides,
  });
  const window = { printerName: '标签机A', startedAtMs: NOW - 301_000, finishedAtMs: NOW - 299_000 };

  test('an empty queue passes', () => {
    expect(queueVerdict({ kind: 'listed', currentUser: 'shop', total: 0, jobs: [] }, 'windows', [], NOW)).toMatchObject(
      {
        status: 'pass',
        detail: '队列是空的',
      },
    );
  });

  test('counts stuck jobs and offers to clear ours, all of them, or open the queue', () => {
    const facts = {
      kind: 'listed' as const,
      currentUser: 'shop',
      total: 3,
      jobs: [job({ id: 1 }), job({ id: 2 }), job({ id: 3, user: 'someone' })],
    };
    const verdict = queueVerdict(facts, 'windows', [window], NOW);
    expect(verdict).toMatchObject({
      status: 'fail',
      detail: '有 3 个任务卡在队列里（最早的已经等了 5 分钟），其中 2 个是本程序发的',
    });
    expect(ids(verdict.fixes)).toEqual(['cancel-own-jobs', 'cancel-all-jobs', 'open-queue']);
    expect(ids(queueVerdict(facts, 'mac', [window], NOW).fixes)).toEqual(['cancel-own-jobs', 'cancel-all-jobs']);
  });

  test('does not offer to clear our jobs when none are ours', () => {
    const facts = { kind: 'listed' as const, currentUser: 'shop', total: 1, jobs: [job({ user: 'someone' })] };
    const verdict = queueVerdict(facts, 'windows', [window], NOW);
    expect(verdict.detail).toBe('有 1 个任务卡在队列里（最早的已经等了 5 分钟），都不是本程序发的');
    expect(ids(verdict.fixes)).toEqual(['cancel-all-jobs', 'open-queue']);
  });
});

describe('paperVerdict', () => {
  test('compares the driver paper with the paper the printer holds', () => {
    expect(paperVerdict({ widthMm: 60, heightMm: 40, dpi: 203 }, LABEL, 'windows')).toMatchObject({
      status: 'pass',
      detail: '驱动纸张 60×40mm，和它负责的 60×40mm 一致',
    });
    const wrong = paperVerdict({ widthMm: 100, heightMm: 150, dpi: 203 }, LABEL, 'windows');
    expect(wrong.detail).toBe('驱动纸张是 100×150mm，它负责的是 60×40mm：打出来可能缩放、跳纸或出空白标签');
    expect(ids(wrong.fixes)).toEqual(['set-driver-paper', 'open-preferences']);
  });

  test('skips a printer that holds no paper', () => {
    expect(paperVerdict(null, null, 'windows')).toMatchObject({ status: 'skipped' });
  });
});

describe('commandsVerdict', () => {
  test('asks the operator to feed one label, because commands are one-way', () => {
    const verdict = commandsVerdict('tspl', 'windows');
    expect(verdict).toMatchObject({ status: 'action', detail: '指令集：TSPL。指令是单向的，程序读不到标签机的回答' });
    expect(ids(verdict.fixes)).toEqual(['feed', 'calibrate', 'change-command-set']);
  });

  test('skips when no commands are sent or this build cannot send them', () => {
    expect(ids(commandsVerdict('none', 'windows').fixes)).toEqual(['change-command-set']);
    expect(commandsVerdict(null, 'windows')).toMatchObject({ status: 'skipped', fixes: [] });
  });
});

describe('missingPrinterVerdict and formatAge', () => {
  test('a printer that left the system list is reported for every check', () => {
    expect(missingPrinterVerdict('queue')).toMatchObject({ check: 'queue', status: 'fail' });
  });

  test('formats waiting time in the largest whole unit', () => {
    expect(formatAge(45_000)).toBe('45 秒');
    expect(formatAge(5 * 60_000 + 30_000)).toBe('5 分钟');
    expect(formatAge(3 * 3_600_000)).toBe('3 小时');
  });
});
