/**
 * Windows 防火墙规则：允许局域网里的电脑连到本机接口。程序（配置中心的按钮）和安装包用同一份脚本。
 * 用 PowerShell 的 NetSecurity 命令而不是 netsh：程序路径里有中文、空格都不用另外转义，还能按程序路径找规则。
 */

import { BRAND } from './brand';

/** 规则名只用 ASCII：经命令行、安装脚本传来传去都不会乱码。 */
export const FIREWALL_RULE_NAME = `${BRAND.productNameAscii} local API`;

export type FirewallAction = 'add' | 'remove' | 'check';

/** PowerShell 单引号字符串：里面只有单引号需要转义（写两个）。 */
export function powerShellLiteral(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

/**
 * 脚本主体，用到 $Name、$Program、$Remove 三个变量。
 * - 先按名称、再按程序路径删掉旧规则：用户拒绝过 Windows 自己弹的防火墙提示时，系统给这个程序留下了阻止规则，
 *   阻止优先于放行，不删的话加了放行规则也没用；装到新位置时，旧位置的规则也一并清掉。
 * - 只在专用和域网络放行，不对公共网络开放。
 */
const MUTATE_BODY = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  # 两路找到的规则先收齐、去重再删：边查边删时，按程序查到的可能是刚删掉的规则留下的过滤条件。
  $old = @(Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue) +
    @(Get-NetFirewallApplicationFilter -Program $Program -ErrorAction SilentlyContinue |
      Get-NetFirewallRule -ErrorAction SilentlyContinue)
  $old | Where-Object { $_ } | Sort-Object -Property Name -Unique | Remove-NetFirewallRule
  if (-not $Remove) {
    New-NetFirewallRule -DisplayName $Name -Direction Inbound -Action Allow -Program $Program -Profile Private,Domain | Out-Null
  }
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`;

/** 查一条启用的、放行这个程序的同名规则；输出 allowed 或 missing。不需要管理员权限。 */
const CHECK_BODY = `
$ProgressPreference = 'SilentlyContinue'
$rules = Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue |
  Where-Object { $_.Enabled -eq 'True' -and $_.Action -eq 'Allow' -and $_.Direction -eq 'Inbound' }
$match = $rules | Where-Object { ($_ | Get-NetFirewallApplicationFilter).Program -eq $Program }
if ($match) { 'allowed' } else { 'missing' }
`;

/** 程序里用：路径直接写进脚本（再整段 Base64 交给 -EncodedCommand，不经过命令行转义）。 */
export function firewallScript(action: FirewallAction, program: string): string {
  const variables = [`$Name = ${powerShellLiteral(FIREWALL_RULE_NAME)}`, `$Program = ${powerShellLiteral(program)}`];
  if (action === 'check') {
    return [...variables, CHECK_BODY].join('\n');
  }
  return [...variables, `$Remove = $${action === 'remove'}`, MUTATE_BODY].join('\n');
}

/** 安装包里用的 .ps1：程序路径和是否删除由参数传入。 */
export function firewallInstallerScript(): string {
  return [
    'param([Parameter(Mandatory = $true)][string]$Program, [switch]$Remove)',
    `$Name = ${powerShellLiteral(FIREWALL_RULE_NAME)}`,
    MUTATE_BODY,
  ].join('\n');
}
