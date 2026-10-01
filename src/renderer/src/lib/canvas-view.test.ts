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
  return { key: name, code: '', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...modifiers };
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

  test('clamps an input below the lowest level or above the highest level', () => {
    expect(zoomIn(-5)).toBe(0.5);
    expect(zoomOut(-5)).toBe(0.5);
    expect(zoomIn(100)).toBe(6);
    expect(zoomOut(100)).toBe(6);
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

  test('ignores Alt combinations, including Ctrl+Alt (AltGr on non-US keyboards)', () => {
    expect(designerCommand(key('ArrowLeft', { altKey: true }))).toBeNull();
    expect(designerCommand(key('z', { ctrlKey: true, altKey: true }))).toBeNull();
  });

  // 非拉丁键盘上，Ctrl+Z 这类组合键的 event.key 是当前布局的字符（例如俄语键盘上的「я」），
  // 不是「z」；但 event.code 是物理键位，不受布局影响，兜底用它识别。
  test('matches Ctrl shortcuts by the physical key code when the layout is not Latin', () => {
    expect(designerCommand(key('я', { code: 'KeyZ', ctrlKey: true }))).toEqual({ kind: 'undo' });
    expect(designerCommand(key('с', { code: 'KeyC', ctrlKey: true }))).toEqual({ kind: 'copy' });
    expect(designerCommand(key('м', { code: 'KeyV', ctrlKey: true }))).toEqual({ kind: 'paste' });
  });
});
