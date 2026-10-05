import { describe, expect, test } from 'bun:test';
import { DEFAULT_COMMAND_CONFIG, type MediaSetup, type PrinterCommandConfig } from './command-model';
import { eplAction, eplGapIssue, eplSetup } from './epl';

const BASE: PrinterCommandConfig = { ...DEFAULT_COMMAND_CONFIG, commandSet: 'epl' };
const LABEL: MediaSetup = { widthMm: 60, heightMm: 40, sensing: 'gap', gapMm: 2 };
const DPI_203 = 203;
/** 比热敏标签机常见的分辨率都低：2mm 的间隙不到 16 个点。 */
const LOW_DPI = 150;

function lf(...lines: string[]): string {
  return lines.map((line) => `${line}\n`).join('');
}

describe('eplSetup', () => {
  test('writes nothing when every setting is left unchanged', () => {
    expect(eplSetup(BASE, DPI_203)).toBe('');
  });

  test('sets width and length in dots with the gap (q, Q p1,p2)', () => {
    expect(eplSetup({ ...BASE, media: LABEL }, DPI_203)).toBe(lf('q480', 'Q320,16'));
  });

  test('marks black-line paper with B (Q p1,Bp2)', () => {
    expect(eplSetup({ ...BASE, media: { ...LABEL, sensing: 'mark', gapMm: 3 } }, DPI_203)).toBe(lf('q480', 'Q320,B24'));
  });

  test('sends density, speed step and orientation (D, S, ZT/ZB)', () => {
    expect(eplSetup({ ...BASE, density: 10, speed: 2, orientation: 'normal' }, DPI_203)).toBe(lf('D10', 'S2', 'ZT'));
    expect(eplSetup({ ...BASE, orientation: 'rotated' }, DPI_203)).toBe(lf('ZB'));
  });
});

describe('eplGapIssue', () => {
  test('accepts gaps within 16–240 dots and explains the rest', () => {
    expect(eplGapIssue(LABEL, DPI_203)).toBeNull();
    expect(eplGapIssue(LABEL, LOW_DPI)).toBe(
      'EPL 的间隙 / 黑标要在 16–240 个打印点之间，2mm 在 150dpi 下是 12 点：请改间隙或分辨率',
    );
  });
});

describe('eplAction', () => {
  test('auto-senses, prints one blank label, prints the configuration and restores defaults', () => {
    expect(eplAction('calibrate')).toBe(lf('xa'));
    // 手册要求 N 前面先发一个空行（LF），清掉命令缓冲区里可能残留的半条指令。
    expect(eplAction('feed')).toBe(lf('', 'N', 'P1'));
    expect(eplAction('selfTest')).toBe(lf('U'));
    expect(eplAction('factoryReset')).toBe(lf('^default'));
  });
});
