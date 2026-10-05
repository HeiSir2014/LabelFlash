import { describe, expect, test } from 'bun:test';
import { DEFAULT_COMMAND_CONFIG, DEFAULT_GAP_MM } from '../../../core/printer-commands/command-model';
import type { PrinterCommandsView } from '../../../shared/printer-commands';
import {
  actionsHint,
  busyFor,
  type CommandForm,
  type CommandRequestTicket,
  commandSetOptions,
  configFromForm,
  densityOptions,
  describeCommandResult,
  describeDetection,
  dpiOptions,
  formFromConfig,
  isFormDirty,
  isSameRequest,
  speedOptions,
  withCommandSet,
} from './printer-commands-view';

const PAPER = { widthMm: 60, heightMm: 40 };
const TSPL_DETECTED = { commandSet: 'tspl', source: 'driver-name' } as const;

function view(overrides: Partial<PrinterCommandsView> = {}): PrinterCommandsView {
  return {
    config: DEFAULT_COMMAND_CONFIG,
    detected: TSPL_DETECTED,
    driverName: 'Label Printer TSPL',
    driverDpi: 203,
    ...overrides,
  };
}

describe('form', () => {
  test('prefills the paper the printer holds and leaves it switched off', () => {
    const form = formFromConfig(DEFAULT_COMMAND_CONFIG, PAPER);
    expect(form.mediaEnabled).toBe(false);
    expect(form.media).toEqual({ widthMm: 60, heightMm: 40, sensing: 'gap', gapMm: DEFAULT_GAP_MM });
    expect(configFromForm(form)).toEqual(DEFAULT_COMMAND_CONFIG);
  });

  test('round-trips a saved config', () => {
    const config = {
      ...DEFAULT_COMMAND_CONFIG,
      commandSet: 'zpl',
      density: 20,
      media: { widthMm: 100, heightMm: 150, sensing: 'mark', gapMm: 3 },
      dpi: 300,
    } as const;
    expect(configFromForm(formFromConfig(config, PAPER))).toEqual(config);
  });

  test('notices unsaved changes', () => {
    const saved = formFromConfig(DEFAULT_COMMAND_CONFIG, PAPER);
    expect(isFormDirty(saved, saved)).toBe(false);
    expect(isFormDirty({ ...saved, density: 3 }, saved)).toBe(true);
  });

  test('drops values the new command set does not have', () => {
    const form: CommandForm = {
      ...formFromConfig(DEFAULT_COMMAND_CONFIG, PAPER),
      commandSet: 'zpl',
      density: 25,
      speed: 6,
      finish: 'tear',
    };
    const next = withCommandSet(form, 'epl', TSPL_DETECTED);
    expect([next.commandSet, next.density, next.speed, next.finish]).toEqual(['epl', null, null, null]);
    // 「自动」认出 TSPL：12 在 0–15 里，保留。
    expect(withCommandSet({ ...form, density: 12 }, 'auto', TSPL_DETECTED).density).toBe(12);
  });
});

describe('options', () => {
  test('labels 自动 with what it detected', () => {
    expect(commandSetOptions(TSPL_DETECTED)[0]).toEqual({ value: 'auto', label: '自动（TSPL）' });
    expect(commandSetOptions(null)[0]).toEqual({ value: 'auto', label: '自动（认不出）' });
    expect(commandSetOptions(null).map((option) => option.value)).toEqual(['auto', 'tspl', 'zpl', 'epl', 'none']);
  });

  test('offers the density range and speeds of each command set', () => {
    expect(densityOptions('tspl').map((option) => option.value)).toEqual([
      '',
      ...Array.from({ length: 16 }, (_, index) => String(index)),
    ]);
    expect(densityOptions('zpl').at(-1)).toEqual({ value: '30', label: '30' });
    expect(speedOptions('tspl')[1]).toEqual({ value: '2', label: '2 英寸/秒' });
    expect(speedOptions('epl')[1]).toEqual({ value: '1', label: '第 1 档' });
  });

  test('names the driver resolution in the default choice', () => {
    expect(dpiOptions(300)[0]).toEqual({ value: '', label: '按驱动（300dpi）' });
    expect(dpiOptions(null)[0]).toEqual({ value: '', label: '按驱动（读不到，按 203dpi）' });
  });
});

describe('describeDetection', () => {
  test('says where the command set came from', () => {
    expect(describeDetection(view())).toBe('驱动名「Label Printer TSPL」里写着 TSPL');
    expect(describeDetection(view({ detected: { commandSet: 'zpl', source: 'catalog' } }))).toBe(
      '按在线识别表，这台用 ZPL',
    );
  });

  test('asks the operator to choose when it cannot tell', () => {
    expect(describeDetection(view({ detected: null, driverName: 'Office Inkjet' }))).toBe(
      '从驱动名「Office Inkjet」认不出用哪种指令：请手动选择；不确定就选「不发指令」，打印照常经驱动',
    );
    expect(describeDetection(view({ detected: null, driverName: null }))).toBe(
      '读不到驱动名：请手动选择；不确定就选「不发指令」，打印照常经驱动',
    );
  });
});

describe('describeCommandResult', () => {
  test('says the settings were sent, not that they took effect', () => {
    expect(describeCommandResult({ status: 'sent', commandSet: 'tspl' }, 'save')).toEqual({
      tone: 'ok',
      text: '设置已发送到打印机（TSPL）。指令是单向的：打一张看看效果',
    });
    expect(describeCommandResult({ status: 'sent', commandSet: 'zpl' }, 'calibrate')).toEqual({
      tone: 'ok',
      text: '纸张校准指令已发送到打印机',
    });
  });

  test('explains why nothing was sent', () => {
    expect(describeCommandResult({ status: 'not-sent', reason: 'unknown-command-set' }, 'save').text).toBe(
      '已保存。认不出这台打印机用哪种指令，没有发送：请在「指令集」里选一种',
    );
    expect(describeCommandResult({ status: 'not-sent', reason: 'no-command-set' }, 'feed').text).toBe(
      '这台打印机设为「不发指令」，没有发送',
    );
    expect(describeCommandResult({ status: 'not-sent', reason: 'nothing-to-send' }, 'save').text).toBe(
      '已保存。各项都是「不改」，没有要发送的设置',
    );
  });

  test('gives the next step for each failure', () => {
    const failed = (reason: 'raw-rejected' | 'uncertain' | 'error', detail = 'x') =>
      describeCommandResult({ status: 'failed', reason, detail }, 'save');
    expect(failed('raw-rejected')).toMatchObject({ tone: 'error' });
    expect(failed('raw-rejected').text).toContain('驱动不接受直接发送的指令');
    expect(failed('uncertain').text.startsWith('不确定有没有发出去')).toBe(true);
    expect(failed('error', 'lp: busy').text).toBe('发送失败：lp: busy。检查打印机是否开着、连好，再试一次');
  });
});

describe('busyFor / isSameRequest', () => {
  // 展开的打印机换了：之前那次请求不该再把当前面板显示成「正在发送」，也不该用它的结果刷新当前面板。
  const ticket: CommandRequestTicket = { printerName: '标签机A', request: 'save' };

  test('busyFor only shows the request on the printer it belongs to', () => {
    expect(busyFor(ticket, '标签机A')).toBe('save');
    expect(busyFor(ticket, '家用打印机')).toBeNull();
    expect(busyFor(ticket, null)).toBeNull();
    expect(busyFor(null, '标签机A')).toBeNull();
  });

  test('isSameRequest matches only the exact printer and request it was issued for', () => {
    expect(isSameRequest(ticket, '标签机A', 'save')).toBe(true);
    expect(isSameRequest(ticket, '标签机A', 'feed')).toBe(false);
    expect(isSameRequest(ticket, '家用打印机', 'save')).toBe(false);
    expect(isSameRequest(null, '标签机A', 'save')).toBe(false);
  });
});

describe('actionsHint', () => {
  test('explains why the action buttons are off', () => {
    expect(actionsHint('tspl', false)).toBeNull();
    expect(actionsHint('tspl', true)).toBe('有没保存的修改：下面的按钮按已保存的设置发送，先点「保存并发送」');
    expect(actionsHint(null, false)).toBe('没有可用的指令集，下面的按钮不能用：先在「指令集」里选一种并保存');
  });
});
