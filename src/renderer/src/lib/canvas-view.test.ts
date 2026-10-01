import { describe, expect, test } from 'bun:test';
import {
  type DesignerKey,
  designerCommand,
  NUDGE_LARGE_MM,
  NUDGE_MM,
  PX_PER_MM,
  pxToMm,
  ZOOM_LEVELS,
  zoomIn,
  zoomOut,
} from './canvas-view';

function key(name: string, modifiers: Partial<Omit<DesignerKey, 'key'>> = {}): DesignerKey {
  return { key: name, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...modifiers };
}

describe('zoom', () => {
  test('steps to the next level up or down', () => {
    expect(zoomIn(1)).toBe(1.5);
    expect(zoomOut(1)).toBe(0.75);
  });

  test('steps from a fitted zoom to the nearest level', () => {
    expect(zoomIn(1.2)).toBe(1.5);
    expect(zoomOut(1.2)).toBe(1);
  });

  test('stays at the ends', () => {
    expect(zoomIn(ZOOM_LEVELS.at(-1) ?? 0)).toBe(6);
    expect(zoomOut(ZOOM_LEVELS[0] ?? 0)).toBe(0.5);
  });

  test('converts screen pixels to millimetres at a zoom', () => {
    expect(pxToMm(PX_PER_MM * 2, 2)).toBe(1);
  });
});

describe('designerCommand', () => {
  test('nudges by a tenth of a millimetre, or one millimetre with Shift', () => {
    expect(designerCommand(key('ArrowRight'))).toEqual({ kind: 'nudge', dx: NUDGE_MM, dy: 0 });
    expect(designerCommand(key('ArrowUp', { shiftKey: true }))).toEqual({ kind: 'nudge', dx: 0, dy: -NUDGE_LARGE_MM });
  });

  test('maps the Ctrl and Command shortcuts', () => {
    expect(designerCommand(key('z', { ctrlKey: true }))).toEqual({ kind: 'undo' });
    expect(designerCommand(key('Z', { ctrlKey: true, shiftKey: true }))).toEqual({ kind: 'redo' });
    expect(designerCommand(key('y', { ctrlKey: true }))).toEqual({ kind: 'redo' });
    expect(designerCommand(key('c', { metaKey: true }))).toEqual({ kind: 'copy' });
    expect(designerCommand(key('v', { ctrlKey: true }))).toEqual({ kind: 'paste' });
    expect(designerCommand(key('a', { ctrlKey: true }))).toBeNull();
  });

  test('deletes with Delete or Backspace and clears the selection with Escape', () => {
    expect(designerCommand(key('Delete'))).toEqual({ kind: 'delete' });
    expect(designerCommand(key('Backspace'))).toEqual({ kind: 'delete' });
    expect(designerCommand(key('Escape'))).toEqual({ kind: 'deselect' });
  });

  // 扫码枪「打字」的字符不能被画布吃掉：配置中心要把它们送进「预览内容」（见 use-config-scan）。
  test('leaves the characters a scanner types alone', () => {
    for (const character of ['a', 'Z', '7', '-', '{', '中', ' ', 'Enter', 'Tab']) {
      expect(designerCommand(key(character))).toBeNull();
      expect(designerCommand(key(character, { shiftKey: true }))).toBeNull();
    }
  });

  test('ignores Alt combinations', () => {
    expect(designerCommand(key('ArrowLeft', { altKey: true }))).toBeNull();
  });
});
