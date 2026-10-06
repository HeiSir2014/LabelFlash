import { describe, expect, test } from 'bun:test';
import { type BackgroundUpdateState, canUpdateInBackground, HIDDEN_BEFORE_UPDATE_MS } from './background-update';

const NOW = 10_000_000;
const IDLE: BackgroundUpdateState = {
  isUpdateReady: true,
  hiddenSince: NOW - HIDDEN_BEFORE_UPDATE_MS,
  pendingPrints: 0,
  isMobileOn: false,
  hasUnsavedTemplate: false,
  now: NOW,
};

describe('canUpdateInBackground', () => {
  // 关到托盘、没人在用：静默装好新版本，回到托盘里，不打扰任何人。
  test('updates once the window has sat in the tray for a while and nothing is in use', () => {
    expect(canUpdateInBackground(IDLE)).toBe(true);
  });

  test('waits for a downloaded update', () => {
    expect(canUpdateInBackground({ ...IDLE, isUpdateReady: false })).toBe(false);
  });

  // 窗口开着说明有人在用；刚关到托盘的，可能马上又打开。
  test('waits while the window is open or was closed only a moment ago', () => {
    expect(canUpdateInBackground({ ...IDLE, hiddenSince: null })).toBe(false);
    expect(canUpdateInBackground({ ...IDLE, hiddenSince: NOW - HIDDEN_BEFORE_UPDATE_MS + 1 })).toBe(false);
  });

  // 重启会打断正在打的标签（桌面、手机、本机接口都走同一个打印队列）。
  test('waits while labels are waiting or printing', () => {
    expect(canUpdateInBackground({ ...IDLE, pendingPrints: 1 })).toBe(false);
  });

  // 重启会结束手机扫码的会话，所有手机都得重新扫电脑上的二维码。
  test('waits while phone scanning is on', () => {
    expect(canUpdateInBackground({ ...IDLE, isMobileOn: true })).toBe(false);
  });

  // 静默更新由安装程序直接结束本程序，退出时的「模板没保存」确认来不及弹：改了一半的模板会悄悄丢掉。
  test('waits while a template has unsaved changes', () => {
    expect(canUpdateInBackground({ ...IDLE, hasUnsavedTemplate: true })).toBe(false);
  });
});
