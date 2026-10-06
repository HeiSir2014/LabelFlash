import { describe, expect, test } from 'bun:test';
import {
  TEMPLATE_QUIT_BUTTONS,
  TemplateQuitGuard,
  templateQuitChoice,
  templateQuitDialogText,
  templateSaveFailedText,
} from './template-quit';

describe('TemplateQuitGuard', () => {
  test('asks before quitting only while a template has unsaved changes and the system is not shutting down', () => {
    const guard = new TemplateQuitGuard();
    expect(guard.shouldConfirm(false)).toBe(false);
    guard.setUnsaved('吊牌');
    expect(guard.shouldConfirm(false)).toBe(true);
    expect(guard.shouldConfirm(true)).toBe(false);
    guard.setUnsaved(null);
    expect(guard.shouldConfirm(false)).toBe(false);
  });

  test('resolves a save request with what the page replies', async () => {
    const guard = new TemplateQuitGuard();
    let asked = 0;
    const saving = guard.requestSave(() => {
      asked += 1;
    }, 1_000);
    expect(asked).toBe(1);
    guard.saved(true);
    expect(await saving).toBe(true);
  });

  test('treats no reply in time as not saved, so the app does not quit and lose the edits', async () => {
    const guard = new TemplateQuitGuard();
    expect(await guard.requestSave(() => undefined, 10)).toBe(false);
  });

  test('ignores a reply that nobody is waiting for', () => {
    const guard = new TemplateQuitGuard();
    expect(() => guard.saved(true)).not.toThrow();
  });
});

describe('TemplateQuitGuard.confirmBeforeInstall', () => {
  test('installs right away when no template has unsaved changes', async () => {
    const guard = new TemplateQuitGuard();
    let asked = 0;
    const isAllowed = await guard.confirmBeforeInstall(async () => {
      asked += 1;
      return false;
    });
    expect(isAllowed).toBe(true);
    expect(asked).toBe(0);
  });

  test('asks first while a template has unsaved changes and installs only if the operator agrees', async () => {
    const guard = new TemplateQuitGuard();
    guard.setUnsaved('吊牌');
    expect(await guard.confirmBeforeInstall(async () => true)).toBe(true);
    expect(await guard.confirmBeforeInstall(async () => false)).toBe(false);
  });
});

describe('template quit dialog', () => {
  test('names the template and offers save, discard and cancel', () => {
    const { message, detail } = templateQuitDialogText('吊牌');
    expect(message).toBe('模板「吊牌」有没保存的修改，现在退出吗？');
    expect(detail).toContain('不保存退出');
    expect(TEMPLATE_QUIT_BUTTONS).toEqual(['取消', '不保存退出', '保存并退出']);
  });

  test('maps the dialog buttons to a choice, treating anything unexpected as cancel', () => {
    expect(templateQuitChoice(0)).toBe('cancel');
    expect(templateQuitChoice(1)).toBe('discard');
    expect(templateQuitChoice(2)).toBe('save');
    expect(templateQuitChoice(7)).toBe('cancel');
  });

  test('says what to do when saving did not go through', () => {
    expect(templateSaveFailedText('吊牌').message).toBe('模板「吊牌」没有保存成功，程序没有退出');
  });
});
