import { describe, expect, test } from 'bun:test';
import type { ProbeCommand } from '../printing/printer-probe-host';
import { ELEVATION_DECLINED_EXIT_CODE, type PowerShellRun } from '../windows-powershell';
import { fixture } from './testing/fixtures';
import { elevatedResult, WindowsDiagnosis } from './windows-diagnosis';
import { SCRIPT_EXIT } from './windows-scripts';

const LABEL = { widthMm: 60, heightMm: 40 };
const run = (exitCode: number | null, stdout = ''): PowerShellRun => ({
  exitCode,
  stdout,
  stderr: '',
  timedOut: false,
});

function harness(answers: Partial<Record<ProbeCommand, string | null>>, elevated: PowerShellRun = run(0)) {
  const queries: [ProbeCommand, string][] = [];
  const scripts: string[] = [];
  const elevatedScripts: string[] = [];
  const system = new WindowsDiagnosis({
    query: async (command, name) => {
      queries.push([command, name]);
      return answers[command] ?? null;
    },
    runScript: async (script) => {
      scripts.push(script);
      return run(0, '2\r\n');
    },
    runElevated: async (script) => {
      elevatedScripts.push(script);
      return elevated;
    },
    openQueueWindow: async () => {},
  });
  return { system, queries, scripts, elevatedScripts };
}

describe('WindowsDiagnosis', () => {
  test('asks the resident probe and parses the answer', async () => {
    const { system, queries } = harness({ jobs: fixture('windows', 'jobs-stuck.txt') });
    expect(await system.jobs('标签机A')).toMatchObject({ kind: 'listed', total: 3 });
    expect(queries).toEqual([['jobs', '标签机A']]);
  });

  test('cancels our jobs without admin rights and reports how many', async () => {
    const { system, scripts, elevatedScripts } = harness({});
    expect(await system.cancelJobs('标签机A', [11, 12])).toEqual({ kind: 'done', count: 2 });
    expect(scripts).toHaveLength(1);
    expect(elevatedScripts).toHaveLength(0);
  });

  test('maps the exit codes of admin scripts', async () => {
    expect(await harness({}, run(ELEVATION_DECLINED_EXIT_CODE)).system.restartSpooler()).toEqual({
      kind: 'declined',
    });
    expect(await harness({}, run(SCRIPT_EXIT.failed)).system.cancelAllJobs('标签机A')).toMatchObject({
      kind: 'failed',
    });
    expect(
      await harness(
        { 'paper-options': fixture('windows', 'paper-options.txt') },
        run(SCRIPT_EXIT.rolledBack),
      ).system.setDriverPaper('标签机A', LABEL, true),
    ).toEqual({ kind: 'rolled-back' });
  });

  // 驱动里没有这种纸、也不能自定义：不弹管理员确认就说明，弹了也做不成。
  test('does not ask for admin rights when the driver has no matching paper', async () => {
    const { system, elevatedScripts } = harness({
      'paper-options':
        '{"options":[{"namespace":"urn:x","localName":"A4","width":210000,"height":297000}],"custom":false}',
    });
    expect(await system.setDriverPaper('标签机A', LABEL, true)).toEqual({ kind: 'no-matching-paper' });
    expect(elevatedScripts).toEqual([]);
  });
});

describe('elevatedResult', () => {
  // UserPrintTicket 失败是「做成了一部分」，不是「读回来的默认纸张不对」：不能和 rolledBack 混在一起，
  // 也不是单纯的 failed（默认纸张其实设置成功了）。
  test('tells a failed UserPrintTicket merge apart from a rolled-back default', () => {
    expect(elevatedResult(run(SCRIPT_EXIT.userTicketFailed))).toMatchObject({ kind: 'partial' });
    expect(elevatedResult(run(SCRIPT_EXIT.userTicketFailed))).not.toMatchObject({ kind: 'rolled-back' });
    expect(elevatedResult(run(SCRIPT_EXIT.userTicketFailed))).not.toMatchObject({ kind: 'failed' });
  });
});
