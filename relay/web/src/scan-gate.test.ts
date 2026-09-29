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

  // 同款的几件衣服一件件扫：移到下一件的一两秒里码离开了画面，就该算新的一次。
  test('takes the same code again after it left the view for a second', () => {
    const gate = new ScanGate();
    gate.accept('A', 0);
    expect(gate.accept('A', 1_000)).toBe(true);
  });

  test('takes a different code at once', () => {
    const gate = new ScanGate();
    gate.accept('A', 0);
    expect(gate.accept('B', FRAME_MS)).toBe(true);
  });

  test('prints each of two labels in view once, while the decoder alternates between them', () => {
    const gate = new ScanGate();
    const accepted: string[] = [];
    for (let frame = 0; frame < 100; frame += 1) {
      const text = frame % 2 === 0 ? 'A' : 'B';
      if (gate.accept(text, frame * FRAME_MS)) {
        accepted.push(text);
      }
    }
    expect(accepted).toEqual(['A', 'B']);
  });

  test('does not let a code typed by hand reset the label in view', () => {
    const gate = new ScanGate();
    gate.accept('A', 0);
    gate.remember('typed by hand', FRAME_MS);
    expect(gate.accept('A', 2 * FRAME_MS)).toBe(false);
  });

  test('keeps a printed code fresh while it is seen but cannot be submitted', () => {
    const gate = new ScanGate();
    gate.accept('A', 0);
    gate.observe('A', SAME_CODE_REARM_MS - 1);
    expect(gate.accept('A', 2 * SAME_CODE_REARM_MS - 2)).toBe(false);
  });

  test('does not remember a new code seen while it cannot be submitted', () => {
    const gate = new ScanGate();
    gate.observe('B', 0);
    expect(gate.accept('B', FRAME_MS)).toBe(true);
  });

  test('remembers a code submitted by hand', () => {
    const gate = new ScanGate();
    gate.remember('A', 0);
    expect(gate.accept('A', FRAME_MS)).toBe(false);
  });
});
