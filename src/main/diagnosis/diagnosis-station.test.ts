import { describe, expect, test } from 'bun:test';
import type { ActionResult, DiagnosisFixRequest } from '../../core/diagnosis/diagnosis-model';
import { SubmittedJobs } from '../../core/diagnosis/submitted-jobs';
import { FakeClock } from '../../core/testing/fake-clock';
import { type FakePrinterSpec, FakePrinters } from '../printing/fake-printers';
import { DiagnosisStation } from './diagnosis-station';
import { FakeDiagnosis, FakeLabelCommands } from './fake-diagnosis';
import type { DriverReinstallSeam } from './seams';

const LABEL = { widthMm: 60, heightMm: 40 };

function setup(spec: Partial<FakePrinterSpec> = {}, drivers: DriverReinstallSeam | null = null) {
  const clock = new FakeClock();
  const specs: FakePrinterSpec[] = [
    { name: '标签机A', paper: { widthMm: 60, heightMm: 40, dpi: 203 }, readiness: { ready: true }, ...spec },
  ];
  const printers = new FakePrinters(specs);
  const submitted = new SubmittedJobs(clock);
  const system = new FakeDiagnosis('windows', specs, printers, submitted, clock);
  const forgotten: string[] = [];
  const logs: string[] = [];
  const station = new DiagnosisStation({
    system,
    isKnownPrinter: async (name) => specs.some((item) => item.name === name),
    driverPaper: (name) => printers.driverPaper(name),
    forgetProfile: (name) => forgotten.push(name),
    openPreferences: (name) => system.openPreferences(name),
    submitted,
    commands: new FakeLabelCommands(specs),
    drivers,
    clock,
    log: (message) => logs.push(message),
  });
  return { station, system, forgotten, logs };
}

function request(overrides: Partial<DiagnosisFixRequest>): DiagnosisFixRequest {
  return { printerName: '标签机A', fix: 'cancel-own-jobs', admin: false, paper: null, ...overrides };
}

describe('DiagnosisStation.check', () => {
  test('runs each check against the system and logs the verdict', async () => {
    const { station, logs } = setup({ diagnosis: { stuckJobs: { ours: 1, others: 0 } } });
    expect(await station.check('标签机A', 'queue', null)).toMatchObject({
      status: 'fail',
      detail: '有 1 个任务卡在队列里（最早的已经等了 5 分钟），都是本程序发的',
    });
    expect(logs.some((line) => line.includes('[diagnosis] 标签机A queue: fail'))).toBe(true);
  });

  // 安全底线：打印机名来自界面，不在系统列表里的不交给任何系统命令。
  test('does not touch the system for a printer that is not listed', async () => {
    const { station } = setup();
    expect(await station.check('别的打印机', 'queue', null)).toMatchObject({
      status: 'fail',
      detail: '系统打印机列表里已经没有这台了',
    });
  });

  test('checks only the print service when no printer is given', async () => {
    const { station } = setup({ diagnosis: { spooler: 'stopped' } });
    expect(await station.check(null, 'spooler', null)).toMatchObject({ status: 'fail' });
    await expect(station.check(null, 'queue', null)).rejects.toThrow('needs a printer');
  });

  test('offers a driver reinstall only through the 5c seam', async () => {
    const notReady = { readiness: { ready: false as const, detail: '打印机报错', issue: 'other' as const } };
    const without = await setup(notReady).station.check('标签机A', 'printer', null);
    expect(without.fixes.map((fix) => fix.id)).toEqual(['open-preferences']);
    const drivers: DriverReinstallSeam = {
      canReinstall: async () => true,
      reinstall: async (): Promise<ActionResult> => ({ kind: 'done' }),
    };
    const withSeam = await setup(notReady, drivers).station.check('标签机A', 'printer', null);
    expect(withSeam.fixes.map((fix) => fix.id)).toEqual(['open-preferences', 'reinstall-driver']);
  });

  test('skips the paper check for a printer that holds no paper', async () => {
    expect(await setup().station.check('标签机A', 'paper', null)).toMatchObject({ status: 'skipped' });
  });
});

describe('DiagnosisStation.fix', () => {
  test('cancels only our jobs, found again at the time of the fix', async () => {
    const { station } = setup({ diagnosis: { stuckJobs: { ours: 2, others: 1 } } });
    expect(await station.fix(request({}))).toEqual({ status: 'done', message: '已请求取消本程序的 2 个任务' });
    expect(await station.check('标签机A', 'queue', null)).toMatchObject({
      detail: '有 1 个任务卡在队列里（最早的已经等了 5 分钟），都不是本程序发的',
    });
  });

  test('sets the driver paper and forgets the cached profile', async () => {
    const { station, forgotten } = setup({ paper: { widthMm: 100, heightMm: 150, dpi: 203 } });
    expect(await station.fix(request({ fix: 'set-driver-paper', admin: true, paper: LABEL }))).toMatchObject({
      status: 'done',
    });
    expect(forgotten).toEqual(['标签机A']);
    expect(await station.check('标签机A', 'paper', LABEL)).toMatchObject({ status: 'pass' });
  });

  test('reports a declined admin prompt', async () => {
    const { station, system } = setup({ diagnosis: { adminPrompt: 'decline' } });
    expect(await station.fix(request({ fix: 'cancel-all-jobs', admin: true }))).toMatchObject({ status: 'declined' });
    expect(system.adminPrompts).toEqual(['清空队列']);
  });

  // 渲染进程不可信：管理员按钮必须是管理员按钮，反过来也一样；这个系统没有的修复直接拒绝。
  test('rejects requests that do not match the admin policy of the platform', async () => {
    const { station, system } = setup();
    await expect(station.fix(request({ fix: 'cancel-all-jobs', admin: false }))).rejects.toThrow('not allowed');
    await expect(station.fix(request({ fix: 'cancel-own-jobs', admin: true }))).rejects.toThrow('not allowed');
    await expect(station.fix(request({ fix: 'enable-printer' }))).rejects.toThrow('not allowed');
    expect(system.adminPrompts).toEqual([]);
  });

  test('rejects fixes for printers outside the system list and missing paper', async () => {
    const { station } = setup();
    await expect(station.fix(request({ printerName: '别的打印机' }))).rejects.toThrow('system list');
    await expect(station.fix(request({ printerName: null }))).rejects.toThrow('system list');
    await expect(station.fix(request({ fix: 'set-driver-paper', admin: true }))).rejects.toThrow('paper');
  });

  test('restarts the print service without a printer', async () => {
    const { station } = setup({ diagnosis: { spooler: 'stopped' } });
    expect(await station.fix(request({ printerName: null, fix: 'restart-spooler', admin: true }))).toMatchObject({
      status: 'done',
    });
    expect(await station.check(null, 'spooler', null)).toMatchObject({ status: 'pass' });
  });

  test('runs one fix at a time', async () => {
    const { station } = setup({ diagnosis: { stuckJobs: { ours: 1, others: 0 } } });
    const first = station.fix(request({}));
    await expect(station.fix(request({}))).rejects.toThrow('still running');
    await first;
  });

  test('sends the feed command through the 5a seam', async () => {
    const { station } = setup();
    expect(await station.fix(request({ fix: 'feed' }))).toEqual({
      status: 'done',
      message: '走纸指令已发送（进了打印队列）',
    });
  });
});
