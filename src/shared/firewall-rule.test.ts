import { describe, expect, test } from 'bun:test';
import { FIREWALL_RULE_NAME, firewallInstallerScript, firewallScript, powerShellLiteral } from './firewall-rule';

describe('firewall rule scripts', () => {
  test('quotes a path as a PowerShell literal, doubling single quotes', () => {
    expect(powerShellLiteral("C:\\Users\\O'Neil\\CDL-LabelFlash.exe")).toBe("'C:\\Users\\O''Neil\\CDL-LabelFlash.exe'");
  });

  // 只动这个程序路径下的规则：同名规则和针对本程序的阻止规则（Windows 留下的阻止规则优先于放行）。
  test('replaces only the rules for this program before allowing it on every network type', () => {
    const script = firewallScript('add', 'C:\\Programs\\CDL-LabelFlash\\CDL-LabelFlash.exe');
    expect(script).toContain(`$Name = '${FIREWALL_RULE_NAME}'`);
    expect(script).toContain("$Program = 'C:\\Programs\\CDL-LabelFlash\\CDL-LabelFlash.exe'");
    expect(script).toContain('Get-NetFirewallApplicationFilter -Program $Program');
    expect(script).not.toContain('Get-NetFirewallRule -DisplayName');
    expect(script.indexOf('Remove-NetFirewallRule')).toBeLessThan(script.indexOf('New-NetFirewallRule'));
    expect(script).toContain('-Protocol TCP');
    expect(script).toContain('-Profile Any');
  });

  // 以管理员身份运行时从系统目录加载模块，不用用户目录里可能被替换的同名模块。
  test('loads the firewall module from the Windows directory', () => {
    for (const action of ['add', 'remove', 'check'] as const) {
      expect(firewallScript(action, 'C:\\a.exe')).toContain("Import-Module (Join-Path $env:SystemRoot 'System32");
    }
  });

  test('only removes rules when uninstalling', () => {
    expect(firewallScript('remove', 'C:\\a.exe')).toContain('$Remove = $true');
    expect(firewallScript('add', 'C:\\a.exe')).toContain('$Remove = $false');
  });

  test('reports allowed, missing or unknown', () => {
    const script = firewallScript('check', 'C:\\a.exe');
    expect(script).not.toContain('Remove-NetFirewallRule');
    for (const word of ["'allowed'", "'missing'", "'unknown'"]) {
      expect(script).toContain(word);
    }
  });

  // 安装包在运行时才知道程序路径：由参数传入；卸载时先用 -Check 查一下，没有规则就不弹管理员确认。
  test('takes the program, remove and check switches as parameters in the installer script', () => {
    const script = firewallInstallerScript();
    expect(script.startsWith('param(')).toBe(true);
    expect(script).toContain('[string]$Program');
    expect(script).toContain('[switch]$Remove');
    expect(script).toContain('[switch]$Check');
    expect(script).not.toContain('$Program =');
  });
});
