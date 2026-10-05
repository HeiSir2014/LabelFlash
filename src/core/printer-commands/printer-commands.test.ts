import { describe, expect, test } from 'bun:test';
import { DEFAULT_COMMAND_CONFIG, type MediaSetup, type PrinterCommandConfig } from './command-model';
import { buildAction, buildSetup } from './printer-commands';

const BASE: PrinterCommandConfig = DEFAULT_COMMAND_CONFIG;
const LABEL: MediaSetup = { widthMm: 60, heightMm: 40, sensing: 'gap', gapMm: 2 };
const DPI_203 = 203;

describe('buildSetup', () => {
  test('builds the commands of the given command set', () => {
    expect(buildSetup('tspl', { ...BASE, density: 8 }, DPI_203)).toEqual({ ok: true, text: 'DENSITY 8\r\n' });
    expect(buildSetup('zpl', { ...BASE, density: 20 }, DPI_203)).toEqual({ ok: true, text: '~SD20\n^XA\n^JUS\n^XZ\n' });
    expect(buildSetup('epl', { ...BASE, media: LABEL }, DPI_203)).toEqual({ ok: true, text: 'q480\nQ320,16\n' });
  });

  test('returns an empty text when nothing changes', () => {
    expect(buildSetup('tspl', BASE, DPI_203)).toEqual({ ok: true, text: '' });
  });

  // 「自动」下按最宽的范围保存：认出的指令集没有这个值时不发，说清楚哪一项要改。
  test('explains values the command set does not have', () => {
    expect(buildSetup('tspl', { ...BASE, density: 20 }, DPI_203)).toEqual({
      ok: false,
      issue: 'TSPL 的浓度是 0–15，现在是 20：请重新选浓度',
    });
    expect(buildSetup('epl', { ...BASE, speed: 5 }, DPI_203)).toEqual({
      ok: false,
      issue: 'EPL 没有这个速度（5）：请重新选速度',
    });
    expect(buildSetup('epl', { ...BASE, finish: 'tear' }, DPI_203)).toEqual({
      ok: false,
      issue: 'EPL 不能设出纸方式（撕纸 / 剥离）：请改成「不改」',
    });
  });
});

describe('buildAction', () => {
  test('builds the action of the given command set', () => {
    expect(buildAction('zpl', 'feed', BASE)).toEqual({ ok: true, text: '~PH\n' });
    expect(buildAction('tspl', 'calibrate', { ...BASE, media: { ...LABEL, sensing: 'mark' } })).toEqual({
      ok: true,
      text: 'BLINEDETECT\r\n',
    });
    expect(buildAction('epl', 'selfTest', BASE)).toEqual({ ok: true, text: 'U\n' });
  });
});
