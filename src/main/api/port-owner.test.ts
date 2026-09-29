import { describe, expect, test } from 'bun:test';
import { parseLsofOwner, parsePowerShellOwner } from './port-owner';

describe('port owner', () => {
  test('reads the process name PowerShell prints', () => {
    expect(parsePowerShellOwner('nginx\r\n')).toBe('nginx');
    expect(parsePowerShellOwner('  \r\n')).toBeNull();
  });

  // lsof -F 输出：p<进程号>、c<命令名> 各占一行。
  test('reads the command name from lsof field output', () => {
    expect(parseLsofOwner('p812\ncnode\n')).toBe('node');
    expect(parseLsofOwner('')).toBeNull();
  });
});
