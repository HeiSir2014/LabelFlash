import { describe, expect, test } from 'bun:test';
import type { InstallState } from '../../core/drivers/driver-install-flow';
import { createDriverReinstallSeam, mapInstallStateToActionResult } from './diagnosis-seam';
import type { DriverStation } from './driver-station';

describe('mapInstallStateToActionResult', () => {
  test('maps a successful install to done, the only case the 「驱动已重新安装」 text is allowed to appear for', () => {
    const state: InstallState = { phase: 'done', newPrinters: null, needsRestart: false };
    expect(mapInstallStateToActionResult(state)).toEqual({ kind: 'done' });
  });

  test('maps a declined elevation (admin-declined) to declined, not a generic failure', () => {
    const state: InstallState = { phase: 'failed', failure: 'admin-declined', exitCode: null };
    expect(mapInstallStateToActionResult(state)).toEqual({ kind: 'declined' });
  });

  test('maps every other failure to failed with Chinese text, including the exit code when there is one', () => {
    const hashMismatch: InstallState = { phase: 'failed', failure: 'hash-mismatch', exitCode: null };
    expect(mapInstallStateToActionResult(hashMismatch)).toMatchObject({
      kind: 'failed',
      detail: expect.stringContaining('SHA-256'),
    });

    const installerFailed: InstallState = { phase: 'failed', failure: 'installer-failed', exitCode: 1603 };
    const mapped = mapInstallStateToActionResult(installerFailed);
    expect(mapped.kind).toBe('failed');
    expect(mapped.kind === 'failed' ? mapped.detail : '').toContain('1603');
  });

  test('never crashes on an unexpected running state (reinstall() should never resolve with one)', () => {
    const running: InstallState = { phase: 'running', step: 'installing', receivedBytes: 0, totalBytes: 1 };
    expect(mapInstallStateToActionResult(running).kind).toBe('failed');
  });
});

describe('createDriverReinstallSeam', () => {
  function fakeDriverStation(hint: { canInstall: boolean } | null, outcome: InstallState): DriverStation {
    return {
      hints: () => ({
        modelForDriverName: () =>
          hint ? { ...hint, modelId: 'x', brand: '示例', model: 'X1', commandSet: null } : null,
      }),
      reinstall: async () => outcome,
    } as unknown as DriverStation;
  }

  test('canReinstall asks the catalog by driver name, and is false when the driver name cannot be read', async () => {
    const station = fakeDriverStation({ canInstall: true }, { phase: 'done', newPrinters: null, needsRestart: false });
    const seam = createDriverReinstallSeam(
      () => station,
      async (name) => (name === '标签机A' ? '示例品牌 X1' : null),
    );
    expect(await seam.canReinstall('标签机A')).toBe(true);
    expect(await seam.canReinstall('没见过的打印机')).toBe(false);
  });

  test('canReinstall is false when the catalog has no installable package for this driver', async () => {
    const station = fakeDriverStation(null, { phase: 'done', newPrinters: null, needsRestart: false });
    const seam = createDriverReinstallSeam(
      () => station,
      async () => '不在清单里的驱动',
    );
    expect(await seam.canReinstall('标签机A')).toBe(false);
  });

  test('reinstall looks up the driver name, awaits completion and maps the result', async () => {
    const station = fakeDriverStation({ canInstall: true }, { phase: 'done', newPrinters: null, needsRestart: false });
    const seam = createDriverReinstallSeam(
      () => station,
      async () => '示例品牌 X1',
    );
    expect(await seam.reinstall('标签机A')).toEqual({ kind: 'done' });
  });

  test('reinstall throws when the driver name cannot be read, instead of silently doing nothing', async () => {
    const station = fakeDriverStation({ canInstall: true }, { phase: 'done', newPrinters: null, needsRestart: false });
    const seam = createDriverReinstallSeam(
      () => station,
      async () => null,
    );
    await expect(seam.reinstall('标签机A')).rejects.toThrow();
  });
});
