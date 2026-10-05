import { describe, expect, test } from 'bun:test';
import { DEFAULT_COMMAND_CONFIG, type MediaSetup, type PrinterCommandConfig } from './command-model';
import { zplAction, zplSetup } from './zpl';

const BASE: PrinterCommandConfig = { ...DEFAULT_COMMAND_CONFIG, commandSet: 'zpl' };
const LABEL: MediaSetup = { widthMm: 60, heightMm: 40, sensing: 'gap', gapMm: 2 };
const DPI_203 = 203;
const DPI_300 = 300;

function lf(...lines: string[]): string {
  return lines.map((line) => `${line}\n`).join('');
}

describe('zplSetup', () => {
  test('writes nothing when every setting is left unchanged', () => {
    expect(zplSetup(BASE, DPI_203)).toBe('');
  });

  test('converts the paper to dots, picks gap sensing and saves it (^PW ^LL ^MN ^JUS)', () => {
    expect(zplSetup({ ...BASE, media: LABEL }, DPI_203)).toBe(lf('^XA', '^PW480', '^LL320', '^MNY', '^JUS', '^XZ'));
    expect(zplSetup({ ...BASE, media: LABEL }, DPI_300)).toBe(lf('^XA', '^PW709', '^LL472', '^MNY', '^JUS', '^XZ'));
  });

  test('uses mark sensing for black-mark paper', () => {
    expect(zplSetup({ ...BASE, media: { ...LABEL, sensing: 'mark' } }, DPI_203)).toContain('^MNM\n');
  });

  // ~SD 是绝对浓度，固定两位；它也要 ^JUS 才存下来。
  test('sets darkness with a two-digit ~SD before the format', () => {
    expect(zplSetup({ ...BASE, density: 5 }, DPI_203)).toBe(lf('~SD05', '^XA', '^JUS', '^XZ'));
  });

  test('sends speed, orientation and print mode (^PR ^PO ^MM)', () => {
    expect(zplSetup({ ...BASE, speed: 4, orientation: 'rotated', finish: 'peel' }, DPI_203)).toBe(
      lf('^XA', '^PR4', '^POI', '^MMP', '^JUS', '^XZ'),
    );
    expect(zplSetup({ ...BASE, orientation: 'normal', finish: 'tear' }, DPI_203)).toBe(
      lf('^XA', '^PON', '^MMT', '^JUS', '^XZ'),
    );
  });
});

describe('zplAction', () => {
  test('calibrates, feeds one blank label and prints the configuration label', () => {
    expect(zplAction('calibrate')).toBe(lf('~JC'));
    expect(zplAction('feed')).toBe(lf('~PH'));
    expect(zplAction('selfTest')).toBe(lf('~WC'));
  });

  // ^JUN 恢复网络设置：联网的打印机会失联，恢复出厂设置不发它。
  test('restores and saves factory settings without touching the network settings', () => {
    expect(zplAction('factoryReset')).toBe(lf('^XA', '^JUF', '^JUS', '^XZ'));
    expect(zplAction('factoryReset')).not.toContain('^JUN');
  });
});
