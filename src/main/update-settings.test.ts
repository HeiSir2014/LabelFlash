import { describe, expect, test } from 'bun:test';
import { applyUpdateClientSettings, type UpdateClientSettings } from './update-settings';

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
