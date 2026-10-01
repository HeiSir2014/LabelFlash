import { describe, expect, test } from 'bun:test';
import { labelOf } from '../testing/templates';
import { GENERIC_TEMPLATE } from './builtin-templates';
import { applyNoteOverride } from './note-override';

describe('applyNoteOverride', () => {
  const withNote = { ...GENERIC_TEMPLATE, note: { ...GENERIC_TEMPLATE.note, visible: true, text: '模板备注' } };

  test('keeps the template note by default', () => {
    expect(applyNoteOverride(withNote, { kind: 'template' })).toBe(withNote);
  });

  test('hides the note', () => {
    expect(labelOf(applyNoteOverride(withNote, { kind: 'none' })).note.visible).toBe(false);
  });

  test('replaces the text but keeps the template placement and style', () => {
    const result = labelOf(applyNoteOverride(GENERIC_TEMPLATE, { kind: 'text', text: '返修' }));
    expect(result.note).toEqual({ ...GENERIC_TEMPLATE.note, visible: true, text: '返修' });
    expect(GENERIC_TEMPLATE.note.visible).toBe(false);
  });
});
