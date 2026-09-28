import { describe, expect, test } from 'bun:test';
import { STANDARD_TEMPLATE } from './builtin-templates';
import { applyNoteOverride } from './note-override';

describe('applyNoteOverride', () => {
  const withNote = { ...STANDARD_TEMPLATE, note: { ...STANDARD_TEMPLATE.note, visible: true, text: '模板备注' } };

  test('keeps the template note by default', () => {
    expect(applyNoteOverride(withNote, { kind: 'template' })).toBe(withNote);
  });

  test('hides the note', () => {
    expect(applyNoteOverride(withNote, { kind: 'none' }).note.visible).toBe(false);
  });

  test('replaces the text but keeps the template placement and style', () => {
    const result = applyNoteOverride(STANDARD_TEMPLATE, { kind: 'text', text: '返修' });
    expect(result.note).toEqual({ ...STANDARD_TEMPLATE.note, visible: true, text: '返修' });
    expect(STANDARD_TEMPLATE.note.visible).toBe(false);
  });
});
