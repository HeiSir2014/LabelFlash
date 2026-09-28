import { describe, expect, test } from 'bun:test';
import { SAME_CODE_REARM_MS, ScanGate } from './scan-gate';

const FRAME_MS = 160;

describe('ScanGate', () => {
  test('lets the first code through', () => {
    expect(new ScanGate().accept('A', 0)).toBe(true);
  });

  test('prints a code held in view only once, however long it stays', () => {
    const gate = new ScanGate();
    gate.accept('A', 0);
    for (let now = FRAME_MS; now < 60_000; now += FRAME_MS) {
      expect(gate.accept('A', now)).toBe(false);
    }
  });

  test('takes the same code again once it has been out of view long enough', () => {
    const gate = new ScanGate();
    gate.accept('A', 0);
    expect(gate.accept('A', SAME_CODE_REARM_MS - 1)).toBe(false);
    expect(gate.accept('A', 2 * SAME_CODE_REARM_MS)).toBe(true);
  });

  test('takes a different code at once', () => {
    const gate = new ScanGate();
    gate.accept('A', 0);
    expect(gate.accept('B', FRAME_MS)).toBe(true);
    expect(gate.accept('A', 2 * FRAME_MS)).toBe(true);
  });

  test('keeps the last code fresh while it is seen between scans', () => {
    const gate = new ScanGate();
    gate.accept('A', 0);
    // 打印中、结果显示期间还在看着同一张标签。
    gate.observe('A', SAME_CODE_REARM_MS - 1);
    expect(gate.accept('A', 2 * SAME_CODE_REARM_MS - 2)).toBe(false);
  });

  test('does not remember a different code seen between scans', () => {
    const gate = new ScanGate();
    gate.accept('A', 0);
    gate.observe('B', FRAME_MS);
    expect(gate.accept('B', 2 * FRAME_MS)).toBe(true);
  });

  test('remembers a code submitted by hand', () => {
    const gate = new ScanGate();
    gate.remember('A', 0);
    expect(gate.accept('A', FRAME_MS)).toBe(false);
  });
});
