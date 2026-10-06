import { describe, expect, test } from 'bun:test';
import {
  type DesignerKey,
  designerCommand,
  NUDGE_LARGE_MM,
  NUDGE_MM,
  PX_PER_MM,
  pxToMm,
  undoShortcutLabel,
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

  test('never reverses direction for an input outside the levels', () => {
    // 比最小档还小：放大跳到最小档（朝“放大”方向），缩小没有更小的可去，原样不动（不能跳回变大的最小档）。
    expect(zoomIn(-5)).toBe(0.5);
    expect(zoomOut(-5)).toBe(-5);
    // 比最大档还大：缩小收口到最大档（朝“缩小”方向），放大没有更大的可去，原样不动（不能跳回变小的最大档）。
    expect(zoomIn(100)).toBe(100);
    expect(zoomOut(100)).toBe(6);
  });

  test('converts screen pixels to millimetres at a zoom', () => {
    expect(pxToMm(PX_PER_MM * 2, 2)).toBe(1);
  });
});

describe('undoShortcutLabel', () => {
  test('is ⌘Z on macOS and Ctrl+Z elsewhere, matching the config shortcut convention', () => {
    expect(undoShortcutLabel('mac')).toBe('⌘Z');
    expect(undoShortcutLabel('other')).toBe('Ctrl+Z');
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
    expect(designerCommand(key('b', { ctrlKey: true }))).toBeNull();
  });

  test('selects all with Ctrl+A or Command+A', () => {
    expect(designerCommand(key('a', { ctrlKey: true }))).toEqual({ kind: 'selectAll' });
    expect(designerCommand(key('a', { metaKey: true }))).toEqual({ kind: 'selectAll' });
    expect(designerCommand(key('ф', { code: 'KeyA', ctrlKey: true }))).toEqual({ kind: 'selectAll' });
  });

  test('duplicates with Ctrl+D', () => {
    expect(designerCommand(key('d', { ctrlKey: true }))).toEqual({ kind: 'duplicate' });
  });

  test('moves layers with Ctrl+] and Ctrl+[, and to the front or back with Shift', () => {
    expect(designerCommand(key(']', { code: 'BracketRight', ctrlKey: true }))).toEqual({
      kind: 'layer',
      move: 'forward',
    });
    expect(designerCommand(key('[', { code: 'BracketLeft', ctrlKey: true }))).toEqual({
      kind: 'layer',
      move: 'backward',
    });
    // Shift 按着时 key 变成「}」「{」：按物理键位认。
    expect(designerCommand(key('}', { code: 'BracketRight', ctrlKey: true, shiftKey: true }))).toEqual({
      kind: 'layer',
      move: 'front',
    });
    expect(designerCommand(key('{', { code: 'BracketLeft', ctrlKey: true, shiftKey: true }))).toEqual({
      kind: 'layer',
      move: 'back',
    });
  });

  test('fits the window with Ctrl+0 and shows actual size with Ctrl+1', () => {
    expect(designerCommand(key('0', { code: 'Digit0', ctrlKey: true }))).toEqual({ kind: 'zoom', to: 'fit' });
    expect(designerCommand(key('1', { code: 'Digit1', metaKey: true }))).toEqual({ kind: 'zoom', to: 'actual' });
    expect(designerCommand(key('0', { code: 'Numpad0', ctrlKey: true }))).toEqual({ kind: 'zoom', to: 'fit' });
  });

  test('opens the shortcut sheet with F1, which a scanner never types', () => {
    expect(designerCommand(key('F1'))).toEqual({ kind: 'help' });
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

  // 拉丁字母键盘（德语 QWERTZ、法语 AZERTY……）上 key 已经是正确的拉丁字母，
  // 这时要用 key，不能用 code 兜底——不同布局里同一个字母的物理键位不一样。
  test('prefers the typed Latin letter over the physical code on other Latin layouts', () => {
    // 德语 QWERTZ：Z 和 Y 互换，Ctrl+Z 物理键位是 KeyY，但 key 仍是「z」，该触发撤销。
    expect(designerCommand(key('z', { code: 'KeyY', ctrlKey: true }))).toEqual({ kind: 'undo' });
    // 法语 AZERTY：Ctrl+W 物理键位是 KeyZ，但 key 是「w」，不是快捷键，不该被 code 误判成撤销。
    expect(designerCommand(key('w', { code: 'KeyZ', ctrlKey: true }))).toBeNull();
  });
});
