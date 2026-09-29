import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');
const read = (...path: string[]) => readFileSync(join(ROOT, ...path), 'utf8');

describe('installer firewall rule', () => {
  // 每个 Windows 用户各装一份、规则同名：卸载时只能按本程序路径删，不能按名称删掉别人的规则。
  test('the uninstaller removes the rule through the shared script by program path', () => {
    const script = read('resources', 'installer.nsh');
    expect(script).toContain('labelflashFirewallCommand "-Check"');
    expect(script).toContain('labelflashFirewallCommand "-Remove"');
    expect(script).toContain('dist\\.installer\\firewall.ps1');
    expect(script).not.toContain('-DisplayName');
  });

  // 组策略规定了执行策略时 -File 会被拦下；PowerShell 用系统目录里的绝对路径。
  test('runs the script as a script block with the system PowerShell', () => {
    const script = read('resources', 'installer', 'firewall.nsh');
    expect(script).toContain('$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(script).toContain('[scriptblock]::Create(');
    expect(script).not.toContain(' -File ');
  });

  test('the installer adds the rule through the same command', () => {
    const script = read('resources', 'installer', 'installer.nsi');
    expect(script).toContain('!insertmacro labelflashFirewallCommand ""');
    expect(script).not.toContain('ExecShellWait');
  });
});
