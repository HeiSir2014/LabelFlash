import { describe, expect, test } from 'bun:test';
import { elevatedCommand, parseFirewallCheck, powerShellPath } from './firewall';

describe('firewall', () => {
  test('reads the result of the check script', () => {
    expect(parseFirewallCheck('allowed\r\n')).toBe('allowed');
    expect(parseFirewallCheck('missing\r\n')).toBe('missing');
    expect(parseFirewallCheck('unknown\r\n')).toBe('unknown');
    expect(parseFirewallCheck('something else')).toBe('unknown');
  });

  // 不按名字找 powershell.exe：搜索路径（例如程序的工作目录）里可能被放了同名的假程序。
  test('runs PowerShell from the Windows system directory', () => {
    expect(powerShellPath({ SystemRoot: 'C:\\Windows' })).toBe(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    );
    expect(powerShellPath({})).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  });

  // 提权的那个 PowerShell 只拿到 Base64：路径里的中文、空格、单引号都不经过命令行转义。
  test('elevates a script passed as Base64 and reports its exit code', () => {
    const command = elevatedCommand(
      "C:\\O'Neil\\CDL-LabelFlash.exe",
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    );
    expect(command).toMatch(
      /^\$p = Start-Process 'C:\\Windows\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe' -Verb RunAs -Wait -PassThru -WindowStyle Hidden /,
    );
    expect(command).toMatch(/-ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','[A-Za-z0-9+/=]+'/);
    expect(command.endsWith('exit $p.ExitCode')).toBe(true);
    expect(command).not.toContain("O'Neil");
  });
});
