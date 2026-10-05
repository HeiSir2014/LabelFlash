import { describe, expect, test } from 'bun:test';
import { DEFAULT_COMMAND_CONFIG, type MediaSetup, type PrinterCommandConfig } from './command-model';
import { parseCommandConfig, sanitizeCommandConfig } from './sanitize-command-config';

const MEDIA: MediaSetup = { widthMm: 60, heightMm: 40, sensing: 'gap', gapMm: 2 };
const VALID: PrinterCommandConfig = {
  commandSet: 'tspl',
  density: 8,
  speed: 4,
  media: MEDIA,
  orientation: 'normal',
  finish: 'tear',
  dpi: null,
};

describe('sanitizeCommandConfig', () => {
  test('keeps a valid config', () => {
    expect(sanitizeCommandConfig(structuredClone(VALID))).toEqual(VALID);
  });

  // 不用 test.each：Bun 会把 undefined 那一行的参数当成 done 回调。
  test('falls back to 自动 with nothing changed for junk', () => {
    for (const value of [undefined, null, 'tspl', [VALID]]) {
      expect(sanitizeCommandConfig(value)).toEqual(DEFAULT_COMMAND_CONFIG);
    }
  });

  test('turns values the chosen command set does not have into 不改', () => {
    expect(sanitizeCommandConfig({ ...VALID, density: 20, speed: 6 })).toMatchObject({ density: null, speed: null });
    expect(sanitizeCommandConfig({ ...VALID, commandSet: 'epl', finish: 'tear' }).finish).toBeNull();
  });

  test('checks values saved under 自动 against the widest range', () => {
    expect(sanitizeCommandConfig({ ...VALID, commandSet: 'auto', density: 30, speed: 6 })).toMatchObject({
      density: 30,
      speed: 6,
    });
  });

  test('drops paper outside the paper limits and rounds to 0.1mm', () => {
    expect(sanitizeCommandConfig({ ...VALID, media: { ...MEDIA, widthMm: 500 } }).media).toBeNull();
    expect(
      sanitizeCommandConfig({ ...VALID, media: { widthMm: 60.04, heightMm: 40, sensing: 'mark', gapMm: 3.06 } }).media,
    ).toEqual({ widthMm: 60, heightMm: 40, sensing: 'mark', gapMm: 3.1 });
  });
});

describe('parseCommandConfig', () => {
  test('accepts a complete, valid config', () => {
    expect(parseCommandConfig(structuredClone(VALID))).toEqual(VALID);
    expect(parseCommandConfig({ ...DEFAULT_COMMAND_CONFIG })).toEqual(DEFAULT_COMMAND_CONFIG);
  });

  test.each([
    ['command set', { commandSet: 'cpcl' }],
    ['density for the set', { density: 16 }],
    ['speed for the set', { speed: 1 }],
    ['paper', { media: { widthMm: 60 } }],
    ['gap', { media: { ...MEDIA, gapMm: 0.5 } }],
    ['orientation', { orientation: 'left' }],
    ['finish for EPL', { commandSet: 'epl', finish: 'peel' }],
    ['resolution', { dpi: 96 }],
    ['missing field', { dpi: undefined }],
  ])('rejects a bad %s', (_name, patch) => {
    expect(parseCommandConfig({ ...VALID, ...patch })).toBeNull();
  });

  test('rejects anything that is not an object', () => {
    expect(parseCommandConfig(null)).toBeNull();
    expect(parseCommandConfig([VALID])).toBeNull();
  });
});
