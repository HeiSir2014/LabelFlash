import { describe, expect, test } from 'bun:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  FIREWALL_RULE_NAME,
  firewallInstallerScript,
  firewallScript,
  MDNS_UDP_PORT,
  powerShellLiteral,
} from './firewall-rule';

const execFileAsync = promisify(execFile);

describe('firewall rule scripts', () => {
  test('quotes a path as a PowerShell literal, doubling single quotes', () => {
    expect(powerShellLiteral("C:\\Users\\O'Neil\\CDL-LabelFlash.exe")).toBe("'C:\\Users\\O''Neil\\CDL-LabelFlash.exe'");
  });

  // PowerShell 的分词器把几种 Unicode 「智能引号」也当单引号用（Word 粘贴常见），不只是 U+0027：
  // 一个叫 `Label' ; Write-Output INJECTED; '` 或用弯引号写同样内容的打印机名，不把这几种都转义就能跳出字符串字面量。
  const SINGLE_QUOTE_VARIANTS = ["'", '\u2018', '\u2019', '\u201A', '\u201B'];
  test.each(SINGLE_QUOTE_VARIANTS)(
    'doubles the smart-quote variant %s so it cannot close the literal early',
    (quote) => {
      const text = `Label${quote}; Write-Output INJECTED; ${quote}`;
      const literal = powerShellLiteral(text);
      expect(literal).toBe(`'Label${quote}${quote}; Write-Output INJECTED; ${quote}${quote}'`);
    },
  );

  // 真的跑一次 PowerShell：把转义后的字面量原样输出，核对解析出来的字符串和原文一致（不会被当成提前结束的引号、也没有被当成命令执行）。
  test.skipIf(process.platform !== 'win32')(
    'round-trips every quote variant through real PowerShell',
    async () => {
      for (const quote of SINGLE_QUOTE_VARIANTS) {
        const text = `Label${quote}; Write-Output INJECTED; ${quote}`;
        const literal = powerShellLiteral(text);
        const { stdout } = await execFileAsync('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$Name = ${literal}; Write-Output $Name`,
        ]);
        expect(stdout.trim()).toBe(text);
      }
    },
    30_000,
  );

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

  // 局域网共享的自动发现要收 UDP 5353：只在打开了共享时加，而且只放行同一网段来的；安装包不加。
  test('allows mDNS on UDP 5353 from the local subnet only when sharing asks for it', () => {
    const udp = `-Protocol UDP -LocalPort ${MDNS_UDP_PORT} -RemoteAddress LocalSubnet`;
    const withDiscovery = firewallScript('add', 'C:\\a.exe', { discovery: true });
    expect(withDiscovery).toContain('$Discovery = $true');
    expect(withDiscovery).toContain(udp);
    expect(withDiscovery).toContain('-Protocol TCP');
    expect(firewallScript('add', 'C:\\a.exe')).toContain('$Discovery = $false');
    expect(firewallInstallerScript()).toContain('$Discovery = $false');
  });

  // 原来的查询只看 TCP 那条：只有旧规则的电脑上本机接口照旧算放行。
  test('checks the mDNS rule separately', () => {
    expect(firewallScript('check', 'C:\\a.exe')).not.toContain('UDP');
    const script = firewallScript('check-discovery', 'C:\\a.exe');
    expect(script).toContain('Get-NetFirewallPortFilter');
    expect(script).toContain(`'${MDNS_UDP_PORT}'`);
    for (const word of ["'allowed'", "'missing'", "'unknown'"]) {
      expect(script).toContain(word);
    }
  });

  // 以管理员身份运行时从系统目录加载模块，不用用户目录里可能被替换的同名模块。
  test('loads the firewall module from the Windows directory', () => {
    for (const action of ['add', 'remove', 'check', 'check-discovery'] as const) {
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
