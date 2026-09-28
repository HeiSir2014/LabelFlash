import { describe, expect, test } from 'bun:test';
import { MAX_MODULE_DOTS, MIN_MODULE_DOTS, PRINTER_DOT_MM, planQr } from './qr-code';

const BOX_MM = 24;

describe('planQr', () => {
  test('keeps the requested error correction when it fits, with whole-dot modules', () => {
    const plan = planQr('CL5640-TK-图片色-XL', 'M', BOX_MM);
    expect(plan?.level).toBe('M');
    if (!plan) throw new Error('expected a plan');
    expect(Number.isInteger(plan.moduleDots)).toBe(true);
    expect(plan.sizeMm).toBeCloseTo(plan.moduleCount * plan.moduleDots * PRINTER_DOT_MM);
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
