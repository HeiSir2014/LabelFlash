import { describe, expect, test } from 'bun:test';
import {
  applyUpdateClientSettings,
  INSTALL_OPTIONS,
  initialUpdateStatus,
  type UpdateClientSettings,
} from './update-settings';

/** 每一项都和期望相反：只有 applyUpdateClientSettings 设过的值才可能通过断言。 */
function clientWithOppositeDefaults(): UpdateClientSettings {
  return {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    autoRunAppAfterInstall: false,
    allowPrerelease: true,
    allowDowngrade: true,
    disableWebInstaller: false,
    disableDifferentialDownload: true,
  };
}

describe('initialUpdateStatus', () => {
  test('updates the packaged Windows app', () => {
    expect(initialUpdateStatus('win32', true)).toEqual({ state: 'idle' });
  });

  test('never updates a development build', () => {
    expect(initialUpdateStatus('win32', false)).toEqual({ state: 'disabled', reason: 'development' });
    expect(initialUpdateStatus('darwin', false)).toEqual({ state: 'disabled', reason: 'development' });
  });

  // macOS 的安装包没有 Apple 开发者签名，Squirrel.Mac 校验不过签名，下载了也装不上。
  test('does not update the unsigned macOS package', () => {
    expect(initialUpdateStatus('darwin', true)).toEqual({ state: 'disabled', reason: 'unsupported-platform' });
  });

  test('does not update platforms without an installer', () => {
    expect(initialUpdateStatus('linux', true)).toEqual({ state: 'disabled', reason: 'unsupported-platform' });
  });
});

describe('applyUpdateClientSettings', () => {
  test('downloads the published installer with blockmap differential download, never a web installer', () => {
    const client = clientWithOppositeDefaults();
    applyUpdateClientSettings(client);
    expect(client.disableWebInstaller).toBe(true);
    expect(client.disableDifferentialDownload).toBe(false);
  });

  test('downloads in the background and installs on quit when the operator never restarts', () => {
    const client = clientWithOppositeDefaults();
    applyUpdateClientSettings(client);
    expect(client.autoDownload).toBe(true);
    expect(client.autoInstallOnAppQuit).toBe(true);
    expect(client.autoRunAppAfterInstall).toBe(true);
  });

  test('takes only formal releases and never installs an older version', () => {
    const client = clientWithOppositeDefaults();
    applyUpdateClientSettings(client);
    expect(client.allowPrerelease).toBe(false);
    expect(client.allowDowngrade).toBe(false);
  });
});

describe('INSTALL_OPTIONS', () => {
  // 「重启更新」点一次就装：不弹安装界面，装完自动启动新版本（新版本自己回到前台，见 window-activation.ts）。
  test('installs silently and starts the new version afterwards', () => {
    expect(INSTALL_OPTIONS).toEqual({ isSilent: true, isForceRunAfter: true });
  });
});
