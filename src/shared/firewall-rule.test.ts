import { describe, expect, test } from 'bun:test';
import { FIREWALL_RULE_NAME, firewallInstallerScript, firewallScript, powerShellLiteral } from './firewall-rule';

describe('firewall rule scripts', () => {
  test('quotes a path as a PowerShell literal, doubling single quotes', () => {
    expect(powerShellLiteral("C:\\Users\\O'Neil\\CDL-LabelFlash.exe")).toBe("'C:\\Users\\O''Neil\\CDL-LabelFlash.exe'");
  });

  // 先按名称和程序路径清掉旧规则：用户拒绝过 Windows 自己的防火墙提示时，系统留下的阻止规则优先于放行规则。
  test('removes old rules for the program before allowing it on private and domain networks', () => {
    const script = firewallScript('add', 'C:\\Programs\\CDL-LabelFlash\\CDL-LabelFlash.exe');
    expect(script).toContain(`$Name = '${FIREWALL_RULE_NAME}'`);
    expect(script).toContain("$Program = 'C:\\Programs\\CDL-LabelFlash\\CDL-LabelFlash.exe'");
    expect(script.indexOf('Remove-NetFirewallRule')).toBeLessThan(script.indexOf('New-NetFirewallRule'));
    expect(script).toContain('-Profile Private,Domain');
    expect(script).not.toContain('Public');
  });

  test('only removes rules when uninstalling', () => {
    expect(firewallScript('remove', 'C:\\a.exe')).toContain('$Remove = $true');
    expect(firewallScript('add', 'C:\\a.exe')).toContain('$Remove = $false');
  });

  test('checks that an enabled rule allows this very program', () => {
    const script = firewallScript('check', 'C:\\a.exe');
    expect(script).not.toContain('Remove-NetFirewallRule');
    expect(script).toContain("'allowed'");
  });

  // 安装包带一份脚本文件：路径由参数传入（Windows 路径里不会有双引号），不用在 NSIS 里转义。
  test('takes the program and the action as parameters in the installer script', () => {
    const script = firewallInstallerScript();
    expect(script.startsWith('param(')).toBe(true);
    expect(script).toContain('[string]$Program');
    expect(script).toContain('[switch]$Remove');
  });
});
