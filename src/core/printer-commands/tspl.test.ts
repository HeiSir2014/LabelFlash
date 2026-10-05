import { describe, expect, test } from 'bun:test';
import { DEFAULT_COMMAND_CONFIG, type MediaSetup, type PrinterCommandConfig } from './command-model';
import { tsplAction, tsplSetup } from './tspl';

const BASE: PrinterCommandConfig = { ...DEFAULT_COMMAND_CONFIG, commandSet: 'tspl' };
const LABEL: MediaSetup = { widthMm: 60, heightMm: 40, sensing: 'gap', gapMm: 2 };

function crlf(...lines: string[]): string {
  return lines.map((line) => `${line}\r\n`).join('');
}

describe('tsplSetup', () => {
  test('writes nothing when every setting is left unchanged', () => {
    expect(tsplSetup(BASE)).toBe('');
  });

  // 手册的公制写法：SIZE m mm,n mm；GAP m mm,n mm。
  test('sets the paper size and gap in millimetres', () => {
    expect(tsplSetup({ ...BASE, media: LABEL })).toBe(crlf('SIZE 60 mm,40 mm', 'GAP 2 mm,0 mm'));
  });

  test('uses BLINE for black-mark paper and keeps one decimal', () => {
    const media: MediaSetup = { widthMm: 76.5, heightMm: 130, sensing: 'mark', gapMm: 3.5 };
    expect(tsplSetup({ ...BASE, media })).toBe(crlf('SIZE 76.5 mm,130 mm', 'BLINE 3.5 mm,0 mm'));
  });

  test('sends density, speed, direction and tear-off in a fixed order', () => {
    const config: PrinterCommandConfig = {
      ...BASE,
      media: LABEL,
      density: 8,
      speed: 4,
      orientation: 'rotated',
      finish: 'tear',
    };
    expect(tsplSetup(config)).toBe(
      crlf('SIZE 60 mm,40 mm', 'GAP 2 mm,0 mm', 'DENSITY 8', 'SPEED 4', 'DIRECTION 1', 'SET PEEL OFF', 'SET TEAR ON'),
    );
  });

  test('switches tear-off off for peel mode', () => {
    expect(tsplSetup({ ...BASE, finish: 'peel', orientation: 'normal' })).toBe(
      crlf('DIRECTION 0', 'SET TEAR OFF', 'SET PEEL ON'),
    );
  });
});

describe('tsplAction', () => {
  test('calibrates with the saved paper type, gap paper by default', () => {
    expect(tsplAction('calibrate', BASE)).toBe(crlf('GAPDETECT'));
    expect(tsplAction('calibrate', { ...BASE, media: { ...LABEL, sensing: 'mark' } })).toBe(crlf('BLINEDETECT'));
  });

  test('feeds a label, prints the self-test page and restores factory settings', () => {
    expect(tsplAction('feed', BASE)).toBe(crlf('FORMFEED'));
    expect(tsplAction('selfTest', BASE)).toBe(crlf('SELFTEST'));
    expect(tsplAction('factoryReset', BASE)).toBe(crlf('INITIALPRINTER'));
  });
});
