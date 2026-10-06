import { describe, expect, test } from 'bun:test';
import { SubmittedJobs } from '../../core/diagnosis/submitted-jobs';
import { FakeClock } from '../../core/testing/fake-clock';
import { type FakePrinterSpec, FakePrinters } from '../printing/fake-printers';
import { FAKE_CURRENT_USER, FakeDiagnosis, FakeLabelCommands } from './fake-diagnosis';

const LABEL = { widthMm: 60, heightMm: 40 };

function setup(spec: Partial<FakePrinterSpec> = {}, platform: 'windows' | 'mac' = 'windows') {
  const clock = new FakeClock();
  const specs: FakePrinterSpec[] = [
    { name: '标签机A', paper: { widthMm: 100, heightMm: 150, dpi: 203 }, readiness: { ready: true }, ...spec },
  ];
  const printers = new FakePrinters(specs);
  const submitted = new SubmittedJobs(clock);
  return { diagnosis: new FakeDiagnosis(platform, specs, printers, submitted, clock), printers, submitted };
}

describe('FakeDiagnosis', () => {
  test('puts stuck jobs in the queue, ours recorded in the ledger', async () => {
    const { diagnosis, submitted } = setup({ diagnosis: { stuckJobs: { ours: 2, others: 1 } } });
    const facts = await diagnosis.jobs('标签机A');
    expect(facts).toMatchObject({ kind: 'listed', currentUser: FAKE_CURRENT_USER, total: 3 });
    expect(submitted.windowsFor('标签机A')).toHaveLength(1);
  });

  test('cancels the jobs it is asked to and clears the rest after an admin prompt', async () => {
    const { diagnosis } = setup({ diagnosis: { stuckJobs: { ours: 1, others: 1 } } });
    expect(await diagnosis.cancelJobs('标签机A', [1])).toEqual({ kind: 'done', count: 1 });
    expect(await diagnosis.jobs('标签机A')).toMatchObject({ total: 1 });
    expect(await diagnosis.cancelAllJobs('标签机A')).toEqual({ kind: 'done' });
    expect(await diagnosis.jobs('标签机A')).toMatchObject({ total: 0 });
    expect(diagnosis.adminPrompts).toHaveLength(1);
  });

  test('a declined prompt changes nothing', async () => {
    const { diagnosis } = setup({ diagnosis: { stuckJobs: { ours: 0, others: 1 }, adminPrompt: 'decline' } });
    expect(await diagnosis.cancelAllJobs('标签机A')).toEqual({ kind: 'declined' });
    expect(await diagnosis.jobs('标签机A')).toMatchObject({ total: 1 });
  });

  test('sets the fake driver paper, behind an admin prompt on Windows only', async () => {
    const windows = setup();
    expect(await windows.diagnosis.setDriverPaper('标签机A', LABEL, true)).toEqual({ kind: 'done' });
    expect(await windows.printers.driverPaper('标签机A')).toEqual({ ...LABEL, dpi: 203 });
    expect(windows.diagnosis.adminPrompts).toHaveLength(1);
    const mac = setup({}, 'mac');
    expect(await mac.diagnosis.setDriverPaper('标签机A', LABEL, false)).toEqual({ kind: 'done' });
    expect(mac.diagnosis.adminPrompts).toHaveLength(0);
    expect(
      await setup({ diagnosis: { paperSettable: false } }).diagnosis.setDriverPaper('标签机A', LABEL, true),
    ).toEqual({
      kind: 'no-matching-paper',
    });
  });

  test('speaks the platform: a stopped print service is the Spooler or a paused CUPS queue', async () => {
    expect(await setup({ diagnosis: { spooler: 'stopped' } }).diagnosis.spooler('标签机A')).toEqual({
      kind: 'windows',
      state: 'stopped',
      startType: 'automatic',
    });
    expect(await setup({ diagnosis: { spooler: 'stopped' } }, 'mac').diagnosis.spooler('标签机A')).toEqual({
      kind: 'mac',
      schedulerRunning: true,
      queue: { enabled: false, acceptingJobs: true },
    });
  });
});

describe('FakeLabelCommands', () => {
  test('reports the configured command set and records what was sent', async () => {
    const commands = new FakeLabelCommands([
      { name: '标签机A', paper: null, readiness: null, diagnosis: { commandSet: 'zpl' } },
      { name: '家用打印机', paper: null, readiness: null },
    ]);
    expect(await commands.effectiveCommandSet('标签机A')).toBe('zpl');
    expect(await commands.effectiveCommandSet('家用打印机')).toBe('tspl');
    expect(await commands.send('标签机A', 'feed')).toEqual({ kind: 'done' });
    expect(commands.sent).toEqual([{ printerName: '标签机A', action: 'feed' }]);
  });
});
