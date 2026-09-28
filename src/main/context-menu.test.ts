import { describe, expect, test } from 'bun:test';
import { buildContextMenuTemplate, type ContextMenuState } from './context-menu';

const ALL_ENABLED = { canCut: true, canCopy: true, canPaste: true, canSelectAll: true };

function state(overrides: Partial<ContextMenuState> = {}): ContextMenuState {
  return { isEditable: false, selectionText: '', editFlags: ALL_ENABLED, ...overrides };
}

describe('buildContextMenuTemplate', () => {
  test('offers cut, copy, paste and select all in editable fields', () => {
    const roles = buildContextMenuTemplate(state({ isEditable: true })).map((item) => item.role ?? item.type);
    expect(roles).toEqual(['cut', 'copy', 'paste', 'separator', 'selectAll']);
  });

  test('mirrors what the field allows right now', () => {
    const template = buildContextMenuTemplate(
      state({ isEditable: true, editFlags: { ...ALL_ENABLED, canCut: false, canPaste: false } }),
    );
    expect(template.find((item) => item.role === 'cut')?.enabled).toBe(false);
    expect(template.find((item) => item.role === 'paste')?.enabled).toBe(false);
  });

  test('offers only copy for selected read-only text', () => {
    const template = buildContextMenuTemplate(state({ selectionText: 'CL5640-TK' }));
    expect(template.map((item) => item.role)).toEqual(['copy']);
  });

  test('shows no menu when there is nothing to act on', () => {
    expect(buildContextMenuTemplate(state({ selectionText: '   ' }))).toEqual([]);
  });

  test('does not register app-level shortcuts that would shadow the renderer', () => {
    for (const item of buildContextMenuTemplate(state({ isEditable: true }))) {
      if (item.accelerator) {
        expect(item.registerAccelerator).toBe(false);
      }
    }
  });
});
