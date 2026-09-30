import { describe, expect, test } from 'bun:test';
import { type ActivatableWindow, bringToFront } from './window-activation';

class FakeWindow implements ActivatableWindow {
  readonly calls: string[] = [];

  constructor(
    private visible: boolean,
    private minimized: boolean,
  ) {}

  isVisible(): boolean {
    return this.visible;
  }

  isMinimized(): boolean {
    return this.minimized;
  }

  show(): void {
    this.calls.push('show');
    this.visible = true;
  }

  minimize(): void {
    this.calls.push('minimize');
    this.minimized = true;
    this.visible = true;
  }

  restore(): void {
    this.calls.push('restore');
    this.minimized = false;
  }

  focus(): void {
    this.calls.push('focus');
  }
}

describe('bringToFront', () => {
  // Windows 的前台锁：刚在别处点过鼠标时，show()、focus() 只会让任务栏按钮闪，窗口留在后面（2026-09-30 本机实测）。
  // 先最小化再还原，系统会激活还原出来的窗口。
  test('minimizes and restores on Windows so the window really comes to the front', () => {
    const hidden = new FakeWindow(false, false);
    bringToFront(hidden, 'win32');
    expect(hidden.calls).toEqual(['minimize', 'restore', 'focus']);
    const behind = new FakeWindow(true, false);
    bringToFront(behind, 'win32');
    expect(behind.calls).toEqual(['minimize', 'restore', 'focus']);
  });

  test('only restores a window that is already minimized on Windows', () => {
    const minimized = new FakeWindow(true, true);
    bringToFront(minimized, 'win32');
    expect(minimized.calls).toEqual(['restore', 'focus']);
  });

  test('shows and focuses on other platforms', () => {
    const hidden = new FakeWindow(false, false);
    bringToFront(hidden, 'darwin');
    expect(hidden.calls).toEqual(['show', 'focus']);
    const minimized = new FakeWindow(true, true);
    bringToFront(minimized, 'darwin');
    expect(minimized.calls).toEqual(['restore', 'show', 'focus']);
  });
});
