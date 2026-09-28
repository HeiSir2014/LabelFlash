import { describe, expect, test } from 'bun:test';
import { editorForPage, planLeave } from './editor-guard';

describe('editorForPage', () => {
  test('reports only the draft of the page on screen', () => {
    const drafts = { rules: { isEditing: true, isDirty: true } };
    expect(editorForPage('rules', drafts, () => undefined)).toMatchObject({ isEditing: true, isDirty: true });
    expect(editorForPage('templates', drafts, () => undefined)).toMatchObject({ isEditing: false, isDirty: false });
    expect(editorForPage(null, drafts, () => undefined)).toMatchObject({ isEditing: false, isDirty: false });
  });

  test('closes the drafts of every page, including one left behind on another page', () => {
    let closed = 0;
    editorForPage('templates', { rules: { isEditing: true, isDirty: false } }, () => closed++).close();
    expect(closed).toBe(1);
  });
});

describe('planLeave', () => {
  test('leaves at once when nothing is unsaved', () => {
    const plan = planLeave({ isEditing: true, isDirty: false, close: () => undefined }, () => undefined);
    expect(plan.needsConfirm).toBe(false);
  });

  test('asks first when there are unsaved changes', () => {
    const plan = planLeave({ isEditing: true, isDirty: true, close: () => undefined }, () => undefined);
    expect(plan.needsConfirm).toBe(true);
  });

  test('closes the editor before running the action', () => {
    const steps: string[] = [];
    const editor = { isEditing: true, isDirty: true, close: () => steps.push('close') };
    const plan = planLeave(editor, () => steps.push('action'));
    expect(steps).toEqual([]);
    plan.leave();
    expect(steps).toEqual(['close', 'action']);
  });
});
