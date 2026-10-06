import { describe, expect, test } from 'bun:test';
import { closeAction } from './window-close';

describe('closeAction', () => {
  test('hides the window in the tray while the app keeps running', () => {
    expect(closeAction({ hasTray: true, isQuitting: false })).toBe('hide');
  });

  test('lets the window close once the quit is certain', () => {
    expect(closeAction({ hasTray: true, isQuitting: true })).toBe('close');
    expect(closeAction({ hasTray: false, isQuitting: true })).toBe('close');
  });

  // 没有托盘时关窗就是退出：先走退出确认，窗口留着；确认框取消了，操作员还有窗口可用。
  test('asks to quit first and keeps the window when there is no tray', () => {
    expect(closeAction({ hasTray: false, isQuitting: false })).toBe('quit');
  });
});
