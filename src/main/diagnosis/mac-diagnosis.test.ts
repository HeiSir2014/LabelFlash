import { describe, expect, test } from 'bun:test';
import type { CommandRun, RunOptions } from './command-runner';
import { MAC_TOOLS } from './mac-commands';
import { MacDiagnosis } from './mac-diagnosis';
import { fixture } from './testing/fixtures';

const ok = (stdout = ''): CommandRun => ({ exitCode: 0, stdout, stderr: '', timedOut: false });
const fail = (stderr: string): CommandRun => ({ exitCode: 1, stdout: '', stderr, timedOut: false });
const LABEL = { widthMm: 60, heightMm: 40 };

function harness(answer: (file: string, args: readonly string[]) => CommandRun, attributes: (string | null)[] = []) {
  const calls: [string, readonly string[]][] = [];
  const system = new MacDiagnosis({
    run: async (file: string, args: readonly string[], _options: RunOptions) => {
      calls.push([file, args]);
      return answer(file, args);
    },
    ippAttributes: async () => attributes.shift() ?? null,
    currentUser: 'shop',
    withJobsTest: (use) => use('/tmp/labelflash-ipp-test/labelflash-get-jobs.test'),
  });
  return { system, calls };
}

describe('MacDiagnosis', () => {
  test('reports a stopped scheduler without asking about the printer', async () => {
    const { system } = harness(() => ok(fixture('mac', 'lpstat-r-stopped.txt')));
    expect(await system.spooler('Label_Printer')).toEqual({ kind: 'mac', schedulerRunning: false, queue: null });
  });

  test('reads whether the printer is paused from its CUPS attributes', async () => {
    const { system } = harness(
      () => ok(fixture('mac', 'lpstat-r-running.txt')),
      [fixture('mac', 'ipp-printer-stopped.txt')],
    );
    expect(await system.spooler('Label_Printer')).toEqual({
      kind: 'mac',
      schedulerRunning: true,
      queue: { enabled: false, acceptingJobs: true },
    });
  });

  test('turns a refused CUPS request into needs-admin and runs the admin version through osascript', async () => {
    const refused = harness(() => fail('cupsenable: Forbidden'));
    expect(await refused.system.enablePrinter('Label_Printer', false)).toEqual({ kind: 'needs-admin' });
    const admin = harness(() => ok());
    expect(await admin.system.enablePrinter('Label_Printer', true)).toEqual({ kind: 'done' });
    expect(admin.calls[0]?.[0]).toBe(MAC_TOOLS.osascript);
    expect(admin.calls[0]?.[1].at(-2)).toBe(
      "'/usr/sbin/cupsenable' 'Label_Printer' && '/usr/sbin/cupsaccept' 'Label_Printer'",
    );
  });

  test('reports a canceled password prompt as declined', async () => {
    const { system } = harness(() => fail('execution error: User canceled. (-128)'));
    expect(await system.cancelAllJobs('Label_Printer')).toEqual({ kind: 'declined' });
  });

  test('sets the default media, and restores the old one when the read-back is wrong', async () => {
    const stopped = fixture('mac', 'ipp-printer-stopped.txt');
    const good = harness(() => ok(), [stopped, fixture('mac', 'ipp-printer-idle.txt')]);
    expect(await good.system.setDriverPaper('Label_Printer', LABEL, false)).toEqual({ kind: 'done' });
    expect(good.calls[0]).toEqual([
      MAC_TOOLS.lpadmin,
      ['-p', 'Label_Printer', '-o', 'media-default=om_60x40mm_60x40mm'],
    ]);

    const ignored = harness(() => ok(), [stopped, stopped]);
    expect(await ignored.system.setDriverPaper('Label_Printer', LABEL, false)).toEqual({ kind: 'rolled-back' });
    expect(ignored.calls[1]).toEqual([
      MAC_TOOLS.lpadmin,
      ['-p', 'Label_Printer', '-o', 'media-default=oe_4x6-label_4x6in'],
    ]);
  });

  test('reads the queue through the temporary Get-Jobs test', async () => {
    const { system, calls } = harness(() => ok(fixture('mac', 'ipp-jobs.txt')));
    expect(await system.jobs('Label_Printer')).toMatchObject({ kind: 'listed', total: 2 });
    expect(calls[0]).toEqual([
      MAC_TOOLS.ipptool,
      ['-tv', 'ipp://localhost/printers/Label_Printer', '/tmp/labelflash-ipp-test/labelflash-get-jobs.test'],
    ]);
  });
});
