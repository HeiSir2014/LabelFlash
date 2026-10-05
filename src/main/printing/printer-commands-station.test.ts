import { describe, expect, test } from 'bun:test';
import { type DriverHints, NO_DRIVER_HINTS } from '../../core/drivers/driver-hints';
import {
  DEFAULT_COMMAND_CONFIG,
  type MediaSetup,
  type PrinterCommandConfig,
} from '../../core/printer-commands/command-model';
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
  hints?: DriverHints;
  sendResult?: RawSendResult;
  driverDpi?: number | null;
}

function harness(options: HarnessOptions = {}) {
  const state: { configs: Record<string, PrinterCommandConfig> } = { configs: {} };
  const sent: { printerName: string; text: string }[] = [];
  const logs: string[] = [];
  const station = new PrinterCommands({
    configs: () => state.configs,
    saveConfigs: (next) => {
      state.configs = next;
    },
    driverNameOf: async (name) => DRIVER_NAMES.get(name) ?? null,
    driverDpi: async () => (options.driverDpi === undefined ? DRIVER_DPI : options.driverDpi),
    hints: options.hints ?? NO_DRIVER_HINTS,
    sender: {
      send: async (printerName, data) => {
        sent.push({ printerName, text: Buffer.from(data).toString('latin1') });
        return options.sendResult ?? { ok: true };
      },
    },
    hasPrinter: async (name) => DRIVER_NAMES.has(name),
    log: (message) => logs.push(message),
    warn: (message) => logs.push(message),
  });
  return { station, state, sent, logs };
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
    const { station } = harness({ hints });
    expect(await station.apply(OFFICE_PRINTER, { ...DEFAULT_COMMAND_CONFIG, density: 8 })).toEqual({
      status: 'sent',
      commandSet: 'epl',
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
    const { station, state, sent } = harness();
    state.configs = { [LABEL_PRINTER]: { ...DEFAULT_COMMAND_CONFIG, media: { ...MEDIA, sensing: 'mark' } } };
    expect(await station.run(LABEL_PRINTER, 'calibrate')).toEqual({ status: 'sent', commandSet: 'tspl' });
    expect(sent).toEqual([{ printerName: LABEL_PRINTER, text: 'BLINEDETECT\r\n' }]);
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
