import { describe, expect, test } from 'bun:test';
import { contextMenuItems, type MenuItem, nextEnabledIndex } from './canvas-menu';

const NONE = { selectionCount: 0, canPaste: false, allLocked: false, platform: 'other' as const };

function labels(items: readonly MenuItem[]): string[] {
  return items.map((item) => item.label);
}

describe('contextMenuItems', () => {
  test('lists the edit, layer and lock actions for a selection', () => {
    const items = contextMenuItems({ ...NONE, selectionCount: 1, canPaste: true });
    expect(labels(items)).toEqual(['复制', '粘贴', '复制一份', '删除', '置顶', '上移一层', '下移一层', '置底', '锁定']);
    expect(items.every((item) => !item.disabled)).toBe(true);
  });

  test('shows the shortcuts for the platform', () => {
    const items = contextMenuItems({ ...NONE, selectionCount: 1, platform: 'mac' });
    expect(items.find((item) => item.label === '复制一份')?.shortcut).toBe('⌘D');
    expect(items.find((item) => item.label === '置顶')?.shortcut).toBe('⇧⌘]');
  });

  test('adds an align submenu when two or more elements are selected', () => {
    const items = contextMenuItems({ ...NONE, selectionCount: 2 });
    const align = items.find((item) => item.label === '对齐');
    expect(labels(align?.submenu ?? [])).toEqual(['左对齐', '水平居中', '右对齐', '顶对齐', '垂直居中', '底对齐']);
    expect(labels(contextMenuItems({ ...NONE, selectionCount: 1 }))).not.toContain('对齐');
  });

  test('offers to unlock when everything selected is locked, and does not offer to delete it', () => {
    const items = contextMenuItems({ ...NONE, selectionCount: 2, allLocked: true });
    expect(labels(items)).toContain('解锁');
    expect(items.find((item) => item.label === '删除')?.disabled).toBe(true);
  });

  test('on empty paper only paste and select all do anything', () => {
    const items = contextMenuItems({ ...NONE, canPaste: true });
    expect(items.filter((item) => !item.disabled).map((item) => item.label)).toEqual(['粘贴', '全选']);
  });
});

describe('nextEnabledIndex', () => {
  const items = [{ disabled: false }, { disabled: true }, { disabled: false }, { disabled: true }] as readonly Pick<
    MenuItem,
    'disabled'
  >[];

  test('moves down and up skipping disabled items, wrapping around', () => {
    expect(nextEnabledIndex(items, 0, 1)).toBe(2);
    expect(nextEnabledIndex(items, 2, 1)).toBe(0);
    expect(nextEnabledIndex(items, 0, -1)).toBe(2);
  });

  test('starts from the first or last enabled item when nothing is focused', () => {
    expect(nextEnabledIndex(items, -1, 1)).toBe(0);
    expect(nextEnabledIndex(items, -1, -1)).toBe(2);
  });

  test('returns -1 when every item is disabled', () => {
    expect(nextEnabledIndex([{ disabled: true }], -1, 1)).toBe(-1);
  });
});
