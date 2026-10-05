import { describe, expect, test } from 'bun:test';
import { type CatalogModelHint, type DriverHints, NO_DRIVER_HINTS } from '../drivers/driver-hints';
import { detectCommandSet, effectiveCommandSet, guessFromDriverName } from './command-set';

function hintsWith(hint: CatalogModelHint): DriverHints {
  return { modelForDriverName: () => hint };
}

describe('guessFromDriverName', () => {
  test('finds the command set written in the driver name', () => {
    expect(guessFromDriverName('Label Printer TSPL')).toBe('tspl');
    expect(guessFromDriverName('Thermal 203dpi (TSPL2)')).toBe('tspl');
    expect(guessFromDriverName('Label ZPL II')).toBe('zpl');
    expect(guessFromDriverName('Label ZPL2')).toBe('zpl');
    expect(guessFromDriverName('label epl2 driver')).toBe('epl');
  });

  test('does not guess from names without a command set or with several', () => {
    expect(guessFromDriverName('Office Inkjet')).toBeNull();
    expect(guessFromDriverName('Generic / Text Only')).toBeNull();
    expect(guessFromDriverName('Label EPL/ZPL')).toBeNull();
    // 指令集的字样必须单独成词：型号里碰巧连着这几个字母不算。
    expect(guessFromDriverName('XZPL300')).toBeNull();
  });
});

describe('detectCommandSet', () => {
  test('prefers the online catalog over the driver name', async () => {
    const hints = hintsWith({ modelId: 'example', brand: '示例', model: 'X1', commandSet: 'zpl', canInstall: false });
    expect(await detectCommandSet('Label TSPL', hints)).toEqual({ commandSet: 'zpl', source: 'catalog' });
  });

  // 清单认得这台打印机的型号，但没写指令集：仍退回按驱动名猜，不当成「认不出」。
  test('falls back to the driver name when the catalog knows the model but not its command set', async () => {
    const hints = hintsWith({ modelId: 'example', brand: '示例', model: 'X1', commandSet: null, canInstall: false });
    expect(await detectCommandSet('Label TSPL', hints)).toEqual({ commandSet: 'tspl', source: 'driver-name' });
  });

  test('falls back to the driver name, then to nothing', async () => {
    expect(await detectCommandSet('Label TSPL', NO_DRIVER_HINTS)).toEqual({
      commandSet: 'tspl',
      source: 'driver-name',
    });
    expect(await detectCommandSet('Office Inkjet', NO_DRIVER_HINTS)).toBeNull();
    expect(await detectCommandSet(null, NO_DRIVER_HINTS)).toBeNull();
  });
});

describe('effectiveCommandSet', () => {
  test('uses the manual choice, the detected set for 自动, and nothing for 不发指令', () => {
    const detected = { commandSet: 'tspl', source: 'driver-name' } as const;
    expect(effectiveCommandSet('epl', detected)).toBe('epl');
    expect(effectiveCommandSet('auto', detected)).toBe('tspl');
    expect(effectiveCommandSet('auto', null)).toBeNull();
    expect(effectiveCommandSet('none', detected)).toBeNull();
  });
});
