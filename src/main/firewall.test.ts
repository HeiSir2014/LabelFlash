import { describe, expect, test } from 'bun:test';
import { elevatedCommand, parseFirewallCheck } from './firewall';

describe('firewall', () => {
  test('reads the result of the check script', () => {
    expect(parseFirewallCheck('allowed\r\n')).toBe('allowed');
    expect(parseFirewallCheck('missing\r\n')).toBe('missing');
    expect(parseFirewallCheck('something else')).toBe('unknown');
  });

  // 提权的那个 PowerShell 只拿到 Base64：路径里的中文、空格、单引号都不经过命令行转义。
  test('elevates a script passed as Base64 and reports its exit code', () => {
    const command = elevatedCommand("C:\\O'Neil\\CDL-LabelFlash.exe");
    expect(command).toMatch(/^\$p = Start-Process powershell\.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden /);
    expect(command).toMatch(/-ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','[A-Za-z0-9+/=]+'/);
    expect(command.endsWith('exit $p.ExitCode')).toBe(true);
    expect(command).not.toContain("O'Neil");
  });
});
