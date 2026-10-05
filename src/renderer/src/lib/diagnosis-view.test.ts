import { describe, expect, test } from 'bun:test';
import type { CheckVerdict, DiagnosisCheckId, FixOutcome } from '../../../shared/diagnosis';
import {
  checksAfterFix,
  diagnosisSummary,
  itemBadge,
  shownOffers,
  shownVerdict,
  startDiagnosis,
  withChecking,
  withCommandSetPicker,
  withFeedAnswer,
  withFixOutcome,
  withFixStarted,
  withRequeued,
  withVerdict,
} from './diagnosis-view';

const pass = (check: DiagnosisCheckId): CheckVerdict => ({
  check,
  status: 'pass',
  detail: '没问题',
  nextStep: null,
  fixes: [],
});
const QUEUE: CheckVerdict = {
  check: 'queue',
  status: 'fail',
  detail: '有 1 个任务卡在队列里',
  nextStep: null,
  fixes: [{ id: 'cancel-all-jobs', label: '清除全部任务（需要管理员权限）', admin: true }],
};
const SPOOLER_MAC: CheckVerdict = {
  check: 'spooler',
  status: 'fail',
  detail: '这台打印机在系统里被暂停了',
  nextStep: null,
  fixes: [{ id: 'enable-printer', label: '恢复这台打印机', admin: false }],
};
const COMMANDS: CheckVerdict = {
  check: 'commands',
  status: 'action',
  detail: '指令集：TSPL。指令是单向的，程序读不到标签机的回答',
  nextStep: '点「走一张纸」，看标签机有没有走出一张空白标签',
  fixes: [
    { id: 'feed', label: '走一张纸', admin: false },
    { id: 'calibrate', label: '纸张校准', admin: false },
    { id: 'change-command-set', label: '改指令集', admin: false },
  ],
};
const DONE: FixOutcome = { status: 'done', message: '走纸指令已发送（进了打印队列）' };

function finished(...verdicts: CheckVerdict[]) {
  let view = startDiagnosis('标签机A', '60x40');
  for (const verdict of verdicts) {
    view = withVerdict(view, verdict);
  }
  return view;
}

describe('startDiagnosis', () => {
  test('lists all six checks for a printer and only the print service without one', () => {
    expect(startDiagnosis('标签机A', '60x40').items.map((item) => item.check)).toEqual([
      'spooler',
      'printer',
      'usb',
      'queue',
      'paper',
      'commands',
    ]);
    expect(startDiagnosis(null, null).items.map((item) => item.check)).toEqual(['spooler']);
  });
});

describe('diagnosisSummary', () => {
  test('shows progress, then problems, unknowns and what waits for the operator', () => {
    const started = withChecking(startDiagnosis('标签机A', '60x40'), 'spooler');
    expect(diagnosisSummary(started)).toBe('正在检查（0/6）…');
    const done = finished(
      pass('spooler'),
      pass('printer'),
      pass('usb'),
      QUEUE,
      { ...pass('paper'), status: 'unknown' },
      COMMANDS,
    );
    expect(diagnosisSummary(done)).toBe('查完了：1 项有问题，1 项查不到，1 项待确认');
    expect(
      diagnosisSummary(
        finished(pass('spooler'), pass('printer'), pass('usb'), pass('queue'), pass('paper'), pass('commands')),
      ),
    ).toBe('查完了：没发现问题');
  });
});

describe('fixes', () => {
  test('swaps in the admin button the system asked for', () => {
    let view = finished(SPOOLER_MAC);
    view = withFixStarted(view, 'enable-printer');
    expect(view.busyFix).toBe('enable-printer');
    view = withFixOutcome(view, 'spooler', 'enable-printer', {
      status: 'needs-admin',
      message: '系统要求管理员权限才能做这一步',
      retry: { id: 'enable-printer', label: '恢复这台打印机（需要管理员权限）', admin: true },
    });
    expect(view.busyFix).toBeNull();
    const spooler = view.items[0];
    expect(spooler === undefined ? [] : shownOffers(spooler)).toEqual([
      { id: 'enable-printer', label: '恢复这台打印机（需要管理员权限）', admin: true },
    ]);
  });

  test('rechecks only the affected checks that this panel has', () => {
    expect(checksAfterFix(startDiagnosis('标签机A', null), 'cancel-own-jobs')).toEqual(['queue']);
    expect(checksAfterFix(startDiagnosis(null, null), 'restart-spooler')).toEqual(['spooler']);
    expect(checksAfterFix(startDiagnosis('标签机A', null), 'feed')).toEqual([]);
  });

  test('a requeued check loses its old verdict but keeps the outcome message', () => {
    let view = finished(QUEUE);
    view = withFixOutcome(view, 'queue', 'cancel-all-jobs', { status: 'done', message: '已请求清空这台打印机的队列' });
    view = withRequeued(view, ['queue']);
    const queue = view.items.find((item) => item.check === 'queue');
    expect(queue).toMatchObject({
      phase: 'waiting',
      verdict: null,
      outcome: { message: '已请求清空这台打印机的队列' },
    });
  });
});

describe('feed confirmation', () => {
  const commandsOf = (view: ReturnType<typeof finished>) => view.items.find((item) => item.check === 'commands');

  test('asks the operator after the feed command was sent', () => {
    const view = withFixOutcome(finished(COMMANDS), 'commands', 'feed', DONE);
    expect(commandsOf(view)?.feed).toBe('asking');
  });

  test('a label came out: the command set works', () => {
    const view = withFeedAnswer(withFixOutcome(finished(COMMANDS), 'commands', 'feed', DONE), true);
    const item = commandsOf(view);
    expect(item === undefined ? null : shownVerdict(item)).toMatchObject({
      status: 'pass',
      detail: '操作员确认：标签机走出了空白标签，指令集能通信',
    });
    expect(item === undefined ? '' : itemBadge(item).text).toBe('通过');
  });

  test('nothing came out: suggest another command set and open the picker', () => {
    const view = withFeedAnswer(withFixOutcome(finished(COMMANDS), 'commands', 'feed', DONE), false);
    const item = commandsOf(view);
    expect(item === undefined ? null : shownVerdict(item)?.status).toBe('fail');
    expect(item === undefined ? [] : shownOffers(item).map((offer) => offer.id)).toEqual([
      'feed',
      'change-command-set',
    ]);
    expect(item?.isPickingCommandSet).toBe(true);
  });

  test('the change button opens the picker without asking the main process', () => {
    expect(commandsOf(withCommandSetPicker(finished(COMMANDS)))?.isPickingCommandSet).toBe(true);
  });
});

describe('itemBadge', () => {
  test('shows waiting and checking before a verdict arrives', () => {
    const view = withChecking(startDiagnosis('标签机A', null), 'spooler');
    expect(view.items.map((item) => itemBadge(item).text).slice(0, 2)).toEqual(['正在查…', '等待']);
  });
});
