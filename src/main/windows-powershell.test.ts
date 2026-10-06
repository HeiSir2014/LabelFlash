import { describe, expect, test } from 'bun:test';
import {
  ELEVATION_DECLINED_EXIT_CODE,
  elevatedPowerShellCommand,
  encodePowerShell,
  MAX_ELEVATED_COMMAND_LENGTH,
} from './windows-powershell';

const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

describe('elevatedPowerShellCommand', () => {
  test('elevates a Base64 script and maps a failed prompt to ERROR_CANCELLED', () => {
    const command = elevatedPowerShellCommand("$Name = 'O''Neil 标签机'", POWERSHELL);
    expect(command).toStartWith(
      `try { $p = Start-Process '${POWERSHELL}' -Verb RunAs -Wait -PassThru -WindowStyle Hidden `,
    );
    expect(command).toContain(`'-EncodedCommand','${encodePowerShell("$Name = 'O''Neil 标签机'")}'`);
    expect(command).toContain(`} catch { exit ${ELEVATION_DECLINED_EXIT_CODE} }`);
    expect(command.endsWith('exit $p.ExitCode')).toBe(true);
    expect(command).not.toContain('标签机');
  });

  // Windows 命令行最长 32767 个字符：超了就是脚本写得太大，立刻报错，不让它在系统里被截断。
  test('fails fast on a script too long for a command line', () => {
    expect(() => elevatedPowerShellCommand('x'.repeat(MAX_ELEVATED_COMMAND_LENGTH), POWERSHELL)).toThrow('too long');
  });
});
