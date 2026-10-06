import { describe, expect, test } from 'bun:test';
import { SubmittedJobs } from '../../core/diagnosis/submitted-jobs';
import { type DriverHints, NO_DRIVER_HINTS } from '../../core/drivers/driver-hints';
import {
  DEFAULT_COMMAND_CONFIG,
  type MediaSetup,
  type PrinterCommandConfig,
} from '../../core/printer-commands/command-model';
import { FakeClock } from '../../core/testing/fake-clock';
import { MAX_PRINTER_COMMAND_ENTRIES } from '../../shared/settings';
import { PrinterCommands } from './printer-commands-station';
import type { RawSendResult } from './raw-sender';

const LABEL_PRINTER = '标签机A';
const OFFICE_PRINTER = '家用打印机';
const DRIVER_NAMES = new Map([
  [LABEL_PRINTER, 'Label Printer TSPL'],
  [OFFICE_PRINTER, 'Office Inkjet'],
]);
const MEDIA: MediaSetup = { widthMm: 60, heightMm: 40, sensing: 'gap', gapMm: 2 };
const DRIVER_DPI = 203;

interface HarnessOptions {
  /** 和真实用法一样传取值函数：每次用到都重新取，晚接入的在线驱动清单不用重启就生效。 */
  hints?: () => DriverHints;
  sendResult?: RawSendResult;
  driverDpi?: number | null;
  /** 让某台打印机的 driverNameOf 故意拖延，凑出两个 apply() 交叠执行的时机（并发测试用）。 */
  driverNameDelayMs?: Readonly<Record<string, number>>;
}

function harness(options: HarnessOptions = {}) {
  const state: { configs: Record<string, PrinterCommandConfig> } = { configs: {} };
  const sent: { printerName: string; text: string }[] = [];
  const logs: string[] = [];
  const clock = new FakeClock();
  const submitted = new SubmittedJobs(clock);
  const station = new PrinterCommands({
    configs: () => state.configs,
    saveConfigs: (next) => {
      state.configs = next;
    },
    driverNameOf: async (name) => {
      const delay = options.driverNameDelayMs?.[name];
      if (delay !== undefined) {
        await Bun.sleep(delay);
      }
      return DRIVER_NAMES.get(name) ?? null;
    },
    driverDpi: async () => (options.driverDpi === undefined ? DRIVER_DPI : options.driverDpi),
    hints: options.hints ?? (() => NO_DRIVER_HINTS),
    sender: {
      send: async (printerName, data) => {
        sent.push({ printerName, text: Buffer.from(data).toString('latin1') });
        return options.sendResult ?? { ok: true };
      },
    },
    hasPrinter: async (name) => DRIVER_NAMES.has(name),
    log: (message) => logs.push(message),
    warn: (message) => logs.push(message),
    clock,
    submitted,
  });
  return { station, state, sent, logs, submitted };
}

describe('PrinterCommands.describe', () => {
  test('shows the saved config, what 自动 detects and the driver resolution', async () => {
    expect(await harness().station.describe(LABEL_PRINTER)).toEqual({
      config: DEFAULT_COMMAND_CONFIG,
      detected: { commandSet: 'tspl', source: 'driver-name' },
      driverName: 'Label Printer TSPL',
      driverDpi: DRIVER_DPI,
    });
  });

  test('refuses a printer that is not in the system list', async () => {
    await expect(harness().station.describe('没有这台')).rejects.toThrow('Printer not found');
  });
});

describe('PrinterCommands.apply', () => {
  test('saves the config and sends the settings once', async () => {
    const { station, state, sent } = harness();
    const config: PrinterCommandConfig = { ...DEFAULT_COMMAND_CONFIG, density: 8, media: MEDIA };
    expect(await station.apply(LABEL_PRINTER, config)).toEqual({ status: 'sent', commandSet: 'tspl' });
    expect(state.configs[LABEL_PRINTER]).toEqual(config);
    expect(sent).toEqual([{ printerName: LABEL_PRINTER, text: 'SIZE 60 mm,40 mm\r\nGAP 2 mm,0 mm\r\nDENSITY 8\r\n' }]);
  });

  test('saves without sending when the printer is set to send no commands', async () => {
    const { station, state, sent } = harness();
    const config: PrinterCommandConfig = { ...DEFAULT_COMMAND_CONFIG, commandSet: 'none', density: 8 };
    expect(await station.apply(LABEL_PRINTER, config)).toEqual({ status: 'not-sent', reason: 'no-command-set' });
    expect(state.configs[LABEL_PRINTER]).toEqual(config);
    expect(sent).toEqual([]);
  });

  test('saves without sending when 自动 cannot tell the command set', async () => {
    const { station, sent } = harness();
    expect(await station.apply(OFFICE_PRINTER, { ...DEFAULT_COMMAND_CONFIG, density: 8 })).toEqual({
      status: 'not-sent',
      reason: 'unknown-command-set',
    });
    expect(sent).toEqual([]);
  });

  test('reports nothing to send when every setting is left unchanged', async () => {
    const { station, state, sent } = harness();
    expect(await station.apply(LABEL_PRINTER, DEFAULT_COMMAND_CONFIG)).toEqual({
      status: 'not-sent',
      reason: 'nothing-to-send',
    });
    expect(Object.keys(state.configs)).toEqual([LABEL_PRINTER]);
    expect(sent).toEqual([]);
  });

  test('refuses a value the detected command set does not have, without saving', async () => {
    const { station, state, sent } = harness();
    expect(await station.apply(LABEL_PRINTER, { ...DEFAULT_COMMAND_CONFIG, density: 20 })).toEqual({
      status: 'invalid',
      issue: 'TSPL 的浓度是 0–15，现在是 20：请重新选浓度',
    });
    expect(state.configs).toEqual({});
    expect(sent).toEqual([]);
  });

  test('converts to dots with the chosen resolution before the driver one', async () => {
    const { station, sent } = harness();
    await station.apply(LABEL_PRINTER, { ...DEFAULT_COMMAND_CONFIG, commandSet: 'zpl', media: MEDIA, dpi: 300 });
    expect(sent[0]?.text).toBe('^XA\n^PW709\n^LL472\n^MNY\n^JUS\n^XZ\n');
  });

  test('falls back to 203dpi when the driver reports no resolution', async () => {
    const { station, sent } = harness({ driverDpi: null });
    await station.apply(LABEL_PRINTER, { ...DEFAULT_COMMAND_CONFIG, commandSet: 'epl', media: MEDIA });
    expect(sent[0]?.text).toBe('q480\nQ320,16\n');
  });

  test('uses the online catalog for 自动 when it knows the printer', async () => {
    const hints: DriverHints = {
      modelForDriverName: () => ({ modelId: 'x', brand: '示例', model: 'X1', commandSet: 'epl', canInstall: false }),
    };
    const { station } = harness({ hints: () => hints });
    expect(await station.apply(OFFICE_PRINTER, { ...DEFAULT_COMMAND_CONFIG, density: 8 })).toEqual({
      status: 'sent',
      commandSet: 'epl',
    });
  });

  // hints 是取值函数：5c 的驱动清单下载完成后晚接入，不用重启站点或重建 PrinterCommands 就能生效。
  test('reads hints fresh every time instead of once at construction', async () => {
    let current: DriverHints = NO_DRIVER_HINTS;
    const { station } = harness({ hints: () => current });
    expect(await station.apply(OFFICE_PRINTER, { ...DEFAULT_COMMAND_CONFIG, density: 8 })).toEqual({
      status: 'not-sent',
      reason: 'unknown-command-set',
    });
    current = {
      modelForDriverName: () => ({ modelId: 'x', brand: '示例', model: 'X1', commandSet: 'zpl', canInstall: false }),
    };
    expect(await station.apply(OFFICE_PRINTER, { ...DEFAULT_COMMAND_CONFIG, density: 8 })).toEqual({
      status: 'sent',
      commandSet: 'zpl',
    });
  });

  test('passes on why the system could not take the commands', async () => {
    const failure = { kind: 'raw-rejected', detail: 'win32:1804 StartDocPrinter failed' } as const;
    const { station, logs } = harness({ sendResult: { ok: false, failure } });
    expect(await station.apply(LABEL_PRINTER, { ...DEFAULT_COMMAND_CONFIG, density: 8 })).toEqual({
      status: 'failed',
      reason: 'raw-rejected',
      detail: 'win32:1804 StartDocPrinter failed',
    });
    expect(logs.some((line) => line.includes('raw-rejected'))).toBe(true);
  });

  // apply() 的 target() 中间有 await（认指令集要查驱动名）：这段时间里另一台打印机的 apply() 可能已经存盘，
  // 不能让这一次用进入时读到的旧快照覆盖掉它。
  test('does not lose a concurrent apply to a different printer', async () => {
    const { station, state } = harness({ driverNameDelayMs: { [LABEL_PRINTER]: 20 } });
    const slow = station.apply(LABEL_PRINTER, { ...DEFAULT_COMMAND_CONFIG, commandSet: 'auto', density: 8 });
    // 让出一个微任务，确保 slow 已经读过 configs() 的快照、正等着 driverNameOf。
    await Bun.sleep(0);
    await station.apply(OFFICE_PRINTER, { ...DEFAULT_COMMAND_CONFIG, commandSet: 'none', density: 5 });
    await slow;
    expect(Object.keys(state.configs).sort()).toEqual([LABEL_PRINTER, OFFICE_PRINTER].sort());
    expect(state.configs[LABEL_PRINTER]?.density).toBe(8);
    expect(state.configs[OFFICE_PRINTER]?.density).toBe(5);
  });

  test('refuses to save commands for more printers than the settings hold', async () => {
    const { station, state } = harness();
    state.configs = Object.fromEntries(
      Array.from({ length: MAX_PRINTER_COMMAND_ENTRIES }, (_, index) => [`打印机${index}`, DEFAULT_COMMAND_CONFIG]),
    );
    expect(await station.apply(LABEL_PRINTER, { ...DEFAULT_COMMAND_CONFIG, density: 8 })).toEqual({
      status: 'invalid',
      issue: `最多为 ${MAX_PRINTER_COMMAND_ENTRIES} 台打印机保存指令设置`,
    });
  });
});

describe('PrinterCommands.run', () => {
  test('calibrates with the saved paper type', async () => {
    const { station, state, sent, submitted } = harness();
    state.configs = { [LABEL_PRINTER]: { ...DEFAULT_COMMAND_CONFIG, media: { ...MEDIA, sensing: 'mark' } } };
    expect(await station.run(LABEL_PRINTER, 'calibrate')).toEqual({ status: 'sent', commandSet: 'tspl' });
    expect(sent).toEqual([{ printerName: LABEL_PRINTER, text: 'BLINEDETECT\r\n' }]);
    // 成功发送后账本里有这台打印机的一个时间段：诊断据此认出队列里哪些是本程序发的。
    expect(submitted.windowsFor(LABEL_PRINTER)).toHaveLength(1);
  });

  test('does not record a failed send in the ledger', async () => {
    const { station, submitted } = harness({
      sendResult: { ok: false, failure: { kind: 'error', detail: 'boom' } },
    });
    await station.run(LABEL_PRINTER, 'feed');
    expect(submitted.windowsFor(LABEL_PRINTER)).toEqual([]);
  });

  test('sends nothing when 自动 cannot tell the command set', async () => {
    const { station, sent } = harness();
    expect(await station.run(OFFICE_PRINTER, 'feed')).toEqual({ status: 'not-sent', reason: 'unknown-command-set' });
    expect(sent).toEqual([]);
  });

  test('logs every command it sends', async () => {
    const { station, logs } = harness();
    await station.run(LABEL_PRINTER, 'feed');
    expect(logs).toContain('[printer-commands] sent feed (tspl, 10 bytes) to "标签机A"');
  });
});
