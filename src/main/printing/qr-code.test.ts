import { describe, expect, test } from 'bun:test';
import { DEFAULT_PRINTER_DPI, dotMm, MAX_MODULE_DOTS, MIN_MODULE_DOTS, planQr } from './qr-code';

const BOX_MM = 24;

describe('planQr', () => {
  test('keeps the requested error correction when it fits, with whole-dot modules', () => {
    const plan = planQr('CL5640-TK-图片色-XL', 'M', BOX_MM);
    expect(plan?.level).toBe('M');
    if (!plan) throw new Error('expected a plan');
    expect(Number.isInteger(plan.moduleDots)).toBe(true);
    expect(plan.sizeMm).toBeCloseTo(plan.moduleCount * plan.moduleDots * dotMm(DEFAULT_PRINTER_DPI));
    expect(plan.sizeMm).toBeLessThanOrEqual(BOX_MM);
  });

  test('caps the module size for short content so the quiet zone stays wide enough', () => {
    const plan = planQr('1', 'L', 36);
    expect(plan?.moduleDots).toBe(MAX_MODULE_DOTS);
    expect(plan?.sizeMm).toBeLessThan(36);
  });

  test('lowers the error correction before the modules get too small to scan', () => {
    // 500 字节：H 要 2 个点以下的模块才放得进 24mm，降一级就够。
    const text = 'x'.repeat(500);
    const plan = planQr(text, 'H', BOX_MM);
    expect(plan).not.toBeNull();
    expect(plan?.level).not.toBe('H');
    expect(plan?.moduleDots).toBeGreaterThanOrEqual(MIN_MODULE_DOTS);
  });

  test('gives up rather than printing a code too dense to scan', () => {
    expect(planQr('码'.repeat(600), 'L', BOX_MM)).toBeNull();
    expect(planQr('码'.repeat(1_000), 'L', 36)).toBeNull();
  });

  test('draws crisp modules in a square view box', () => {
    const plan = planQr('A001', 'M', BOX_MM);
    expect(plan?.svg).toContain(`viewBox="0 0 ${plan?.moduleCount} ${plan?.moduleCount}"`);
    expect(plan?.svg).toContain('shape-rendering="crispEdges"');
  });
});

describe('planQr with a quiet zone', () => {
  // 这里的静区模块数只是一个测试用的值，和 MIN_MODULE_DOTS（模块最小点数）没有关系——两者凑巧都是 2，
  // 用一个独立命名的常量，不让读的人以为这两套限制是同一回事。
  const QUIET_ZONE_MODULES = 2;

  test('counts the quiet zone against the box so the modules shrink to leave room for it', () => {
    const withoutQuietZone = planQr('A001', 'M', BOX_MM);
    const withQuietZone = planQr('A001', 'M', BOX_MM, DEFAULT_PRINTER_DPI, QUIET_ZONE_MODULES);
    if (!withoutQuietZone || !withQuietZone) throw new Error('expected both plans');
    expect(withQuietZone.moduleCount).toBe(withoutQuietZone.moduleCount);
    // 静区占去的点数不能再用来放大模块：留了静区的模块数不能比没留的大。
    expect(withQuietZone.moduleDots).toBeLessThanOrEqual(withoutQuietZone.moduleDots);
    const total = (withQuietZone.moduleCount + 2 * QUIET_ZONE_MODULES) * withQuietZone.moduleDots;
    const boxDots = Math.floor(BOX_MM / dotMm(DEFAULT_PRINTER_DPI) + 1e-9);
    expect(total).toBeLessThanOrEqual(boxDots);
  });

  test('gives up when the quiet zone alone would not leave room for a scannable module', () => {
    // 方框刚好够二维码本身按最小模块宽放下：没有静区时放得下，要静区就放不下了。
    const moduleCount = planQr('A001', 'M', BOX_MM)?.moduleCount;
    if (moduleCount === undefined) throw new Error('expected a module count');
    const tightBoxMm = moduleCount * MIN_MODULE_DOTS * dotMm(DEFAULT_PRINTER_DPI);
    expect(planQr('A001', 'M', tightBoxMm)).not.toBeNull();
    expect(planQr('A001', 'M', tightBoxMm, DEFAULT_PRINTER_DPI, QUIET_ZONE_MODULES)).toBeNull();
  });

  test('defaults to no quiet zone, same as before the parameter existed', () => {
    expect(planQr('A001', 'M', BOX_MM, DEFAULT_PRINTER_DPI)).toEqual(
      planQr('A001', 'M', BOX_MM, DEFAULT_PRINTER_DPI, 0),
    );
  });
});

describe('planQr on other resolutions', () => {
  test('aligns modules to the dots of a 300dpi printer', () => {
    const plan = planQr('CL5640-TK-图片色-XL', 'M', 20, 300);
    if (!plan) throw new Error('expected a QR plan');
    expect(plan.sizeMm / dotMm(300)).toBeCloseTo(plan.moduleCount * plan.moduleDots, 6);
  });

  // 模块的最小、最大尺寸按毫米定：分辨率高的打印机不能把二维码打得更小，也不能小到扫不出。
  test('keeps modules at least 0.25mm on a 600dpi printer', () => {
    const plan = planQr('CL5640-TK-图片色-XL', 'M', 20, 600);
    if (!plan) throw new Error('expected a QR plan');
    expect(plan.moduleDots * dotMm(600)).toBeGreaterThanOrEqual(0.24);
  });

  test('prints short content about as large at 600dpi as at 203dpi', () => {
    const low = planQr('1', 'L', 36);
    const high = planQr('1', 'L', 36, 600);
    if (!low || !high) throw new Error('expected QR plans');
    expect(Math.abs(high.sizeMm - low.sizeMm)).toBeLessThan(1);
  });

  test('uses 203dpi when the printer does not say', () => {
    expect(planQr('ABC', 'M', 20)).toEqual(planQr('ABC', 'M', 20, DEFAULT_PRINTER_DPI));
  });
});
