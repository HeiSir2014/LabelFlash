import { describe, expect, test } from 'bun:test';
import { EXAMPLE_SHA256, exampleWindowsTarget } from '../../core/testing/driver-catalog-fixtures';
import { encodePowerShell } from './run-command';
import { ELEVATED_EXIT, elevatedInstallScript, interpretInstallExit, launcherScript } from './windows-install';

const PATH = "C:\\Users\\O'Brien\\AppData\\Local\\Temp\\cdl-labelflash-driver-1\\driver-installer.exe";
const pkg = exampleWindowsTarget().package;
/** Windows 命令行最长 32767 个字符。 */
const MAX_COMMAND_LINE_CHARS = 32_767;

describe('elevatedInstallScript', () => {
  test('copies the verified file, re-hashes it and runs it with the silent arguments', () => {
    const script = elevatedInstallScript(PATH, pkg);
    expect(script).toContain(
      "$Source = 'C:\\Users\\O''Brien\\AppData\\Local\\Temp\\cdl-labelflash-driver-1\\driver-installer.exe'",
    );
    expect(script).toContain(`$Sha256 = '${EXAMPLE_SHA256}'`);
    expect(script).toContain("$Kind = 'exe'");
    expect(script).toContain("$Arguments = '/S'");
    expect(script).toContain('$SuccessCodes = @(0, 3010, 1641)');
  });

  test('points the installer at the protected folder for TEMP and TMP, not the user profile', () => {
    const script = elevatedInstallScript(PATH, pkg);
    expect(script).toContain("$start.EnvironmentVariables['TEMP'] = $dir");
    expect(script).toContain("$start.EnvironmentVariables['TMP'] = $dir");
  });

  test('escapes a Unicode right single quotation mark in the temp path, not just the ASCII apostrophe', () => {
    // U+2019（’）：Word 粘贴来的文字常见，PowerShell 的分词器把它当单引号用，会提前结束字符串字面量。
    const path = 'C:\\Users\\Jane’s PC\\AppData\\Local\\Temp\\cdl-labelflash-driver-2\\driver-installer.exe';
    const script = elevatedInstallScript(path, pkg);
    expect(script).toContain(
      "$Source = 'C:\\Users\\Jane’’s PC\\AppData\\Local\\Temp\\cdl-labelflash-driver-2\\driver-installer.exe'",
    );
  });

  test('runs an msi through msiexec quietly', () => {
    const script = elevatedInstallScript(PATH, { ...pkg, kind: 'msi', silentArgs: ['ALLUSERS=1'] });
    expect(script).toContain("$Kind = 'msi'");
    expect(script).toContain("$Arguments = 'ALLUSERS=1'");
    expect(script).toContain('/qn /norestart');
  });

  test('fits on one Windows command line even with the longest inputs', () => {
    const longest = { ...pkg, silentArgs: Array.from({ length: 8 }, () => 'A'.repeat(64)) };
    const launcher = launcherScript(
      elevatedInstallScript('C:\\'.padEnd(260, 'a'), longest),
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    );
    expect(encodePowerShell(launcher).length).toBeLessThan(MAX_COMMAND_LINE_CHARS - 1_000);
  });
});

describe('launcherScript', () => {
  test('elevates the encoded install script once and maps a declined prompt', () => {
    const elevated = elevatedInstallScript(PATH, pkg);
    const launcher = launcherScript(elevated, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(launcher).toContain('-Verb RunAs');
    expect(launcher).toContain(encodePowerShell(elevated));
    expect(launcher).toContain(String(ELEVATED_EXIT.declined));
  });
});

describe('interpretInstallExit', () => {
  test.each([
    [
      { exitCode: 0, timedOut: false },
      { kind: 'installed', needsRestart: false },
    ],
    [
      { exitCode: 3010, timedOut: false },
      { kind: 'installed', needsRestart: true },
    ],
    [
      { exitCode: 1641, timedOut: false },
      { kind: 'installed', needsRestart: true },
    ],
    [{ exitCode: ELEVATED_EXIT.declined, timedOut: false }, { kind: 'declined' }],
    [{ exitCode: ELEVATED_EXIT.hashMismatch, timedOut: false }, { kind: 'hash-mismatch' }],
    [
      { exitCode: ELEVATED_EXIT.prepareFailed, timedOut: false },
      { kind: 'failed', exitCode: null },
    ],
    [
      { exitCode: 1603, timedOut: false },
      { kind: 'failed', exitCode: 1603 },
    ],
    [{ exitCode: null, timedOut: true }, { kind: 'timeout' }],
  ] as const)('%o → %o', (result, outcome) => {
    expect(interpretInstallExit(result, [0])).toEqual(outcome);
  });

  test('accepts the extra success codes from the catalog', () => {
    expect(interpretInstallExit({ exitCode: 1, timedOut: false }, [0, 1])).toEqual({
      kind: 'installed',
      needsRestart: false,
    });
  });
});
