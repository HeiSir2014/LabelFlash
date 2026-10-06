import { describe, expect, test } from 'bun:test';
import { comboLabel, DESIGNER_SHORTCUTS, shortcutLabel, withShortcut } from './designer-shortcuts';

describe('comboLabel', () => {
  test('writes Ctrl and Shift with plus signs on Windows', () => {
    expect(comboLabel({ mod: true, key: 'Z' }, 'other')).toBe('Ctrl+Z');
    expect(comboLabel({ mod: true, shift: true, key: ']' }, 'other')).toBe('Ctrl+Shift+]');
    expect(comboLabel({ alt: true, pointer: '点击' }, 'other')).toBe('Alt+点击');
  });

  test('writes the macOS symbols in the system order, without plus signs', () => {
    expect(comboLabel({ mod: true, key: 'Z' }, 'mac')).toBe('⌘Z');
    expect(comboLabel({ mod: true, shift: true, key: ']' }, 'mac')).toBe('⇧⌘]');
    expect(comboLabel({ alt: true, pointer: '点击' }, 'mac')).toBe('⌥点击');
    expect(comboLabel({ mod: true, pointer: '拖动' }, 'mac')).toBe('⌘拖动');
  });

  test('uses the platform name of the delete key', () => {
    expect(comboLabel({ key: 'Delete' }, 'other')).toBe('Delete');
    expect(comboLabel({ key: 'Delete' }, 'mac')).toBe('⌫');
  });
});

describe('shortcutLabel and withShortcut', () => {
  test('shows every key combination of an action', () => {
    expect(shortcutLabel('redo', 'other')).toBe('Ctrl+Y / Ctrl+Shift+Z');
    expect(shortcutLabel('redo', 'mac')).toBe('⇧⌘Z');
  });

  test('appends the shortcut to a button name for its tooltip', () => {
    expect(withShortcut('置顶', 'front', 'other')).toBe('置顶（Ctrl+Shift+]）');
    expect(withShortcut('置顶', 'front', 'mac')).toBe('置顶（⇧⌘]）');
  });
});

describe('DESIGNER_SHORTCUTS', () => {
  test('lists the arrow key steps', () => {
    const labels = DESIGNER_SHORTCUTS.map((shortcut) => shortcut.label);
    expect(labels).toContain('移动 0.1mm');
    expect(labels).toContain('移动 1mm');
  });

  // 扫码枪只发可打印字符和回车、Tab：快捷键表里不能有单个字母、数字。
  test('never uses a bare letter or digit, which a scanner would type', () => {
    for (const shortcut of DESIGNER_SHORTCUTS) {
      for (const combo of shortcut.combos) {
        if (!combo.mod && !combo.alt && combo.key !== undefined) {
          expect(combo.key).not.toMatch(/^[\p{L}\p{N}]$/u);
        }
      }
    }
  });

  test('has unique ids', () => {
    const ids = DESIGNER_SHORTCUTS.map((shortcut) => shortcut.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
