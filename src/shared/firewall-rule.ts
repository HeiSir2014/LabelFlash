/**
 * Windows 防火墙规则：允许局域网里的电脑连到本机接口和局域网共享（TCP，按程序放行），
 * 以及局域网共享的自动发现（mDNS，UDP 5353）。程序（配置中心的按钮）和安装包用同一份脚本。
 * 用 PowerShell 的 NetSecurity 命令而不是 netsh：程序路径里有中文、空格都不用另外转义，还能按程序路径找规则。
 */

import { BRAND } from './brand';

/** 规则名只用 ASCII：经命令行、安装脚本传来传去都不会乱码。 */
export const FIREWALL_RULE_NAME = `${BRAND.productNameAscii} local API`;

/** mDNS 的端口（RFC 6762）：局域网共享自动发现要收别的电脑发来的查询。 */
export const MDNS_UDP_PORT = 5353;

export type FirewallAction = 'add' | 'remove' | 'check' | 'check-discovery';

/**
 * PowerShell 的分词器除了 ASCII 单引号（U+0027）还把几种 Unicode 「智能引号」当单引号用
 * （从 Word 粘贴命令时常见），每一种都能提前结束字符串字面量：U+2018 ‘、U+2019 ’、U+201A ‚、U+201B ‛。
 * 打印机名这类外部文字可能带着这些字符（WSD/IPP 自动发现的名字、复制粘贴的驱动名），
 * 这里和 ASCII 单引号一样挨个转义（写两个），不只转义拼接脚本时用的那一种。
 */
const SINGLE_QUOTE_VARIANTS = ["'", '‘', '’', '‚', '‛'];

/** PowerShell 单引号字符串：转义里面每一种会被当成单引号的字符。 */
export function powerShellLiteral(text: string): string {
  const escaped = SINGLE_QUOTE_VARIANTS.reduce((value, quote) => value.replaceAll(quote, quote + quote), text);
  return `'${escaped}'`;
}

/**
 * 从系统目录显式加载防火墙模块：以管理员身份运行时，PowerShell 仍会先到用户自己的「文档」里找模块，
 * 同一用户下的恶意程序可以放一个同名的假模块，借管理员确认框提权。32 位的 PowerShell 会自动转到 SysWOW64。
 */
const IMPORT_MODULE = `Import-Module (Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\Modules\\NetSecurity\\NetSecurity.psd1')`;

/**
 * 加 / 删规则，用到 $Name、$Program、$Remove 三个变量。
 * - 只动这个程序路径下的规则：本程序的同名规则，和针对本程序的阻止规则。用户拒绝过 Windows 自己弹的防火墙提示时，
 *   系统给这个程序留下了阻止规则，阻止优先于放行，不删的话加了放行规则也没用。
 *   不按名称删别处的规则：每个 Windows 用户各装一份，各有各的规则，不能互相删。
 * - 只放行 TCP（本机接口、局域网共享）和 UDP 5353（mDNS）；所有网络类型都生效
 *   （Windows 给新连的 Wi-Fi 默认是「公用网络」，只放专用网络的话店里多半连不上）。
 *   这是按需求方的取舍：公司内部局域网使用，方便优先；局域网里的调用照样要程序密钥。
 */
const MUTATE_BODY = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  ${IMPORT_MODULE}
  $forProgram = @(Get-NetFirewallApplicationFilter -Program $Program -ErrorAction SilentlyContinue |
    Get-NetFirewallRule -ErrorAction SilentlyContinue)
  $forProgram | Where-Object { $_ -and ($_.DisplayName -eq $Name -or $_.Action -eq 'Block') } |
    Sort-Object -Property Name -Unique | Remove-NetFirewallRule
  if (-not $Remove) {
    New-NetFirewallRule -DisplayName $Name -Direction Inbound -Action Allow -Protocol TCP -Program $Program -Profile Any | Out-Null
    New-NetFirewallRule -DisplayName $Name -Direction Inbound -Action Allow -Protocol UDP -LocalPort ${MDNS_UDP_PORT} -Program $Program -Profile Any | Out-Null
  }
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`;

/**
 * 查这台电脑的防火墙让不让局域网连进来，输出一个词（不需要管理员权限）：
 * - allowed：有本程序的放行规则、没有阻止规则（或者防火墙整个关着）；
 * - missing：没有放行规则，或者有针对本程序的阻止规则；
 * - unknown：读不到（例如权限不够）。读不到时不拦局域网访问，由 Windows 自己处理。
 */
const CHECK_BODY = `
$ProgressPreference = 'SilentlyContinue'
try {
  ${IMPORT_MODULE}
  if (-not @(Get-NetFirewallProfile -ErrorAction Stop | Where-Object { $_.Enabled -eq 'True' }).Count) { 'allowed'; exit 0 }
  $rules = @(Get-NetFirewallApplicationFilter -Program $Program -ErrorAction SilentlyContinue |
    Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' })
  $allowed = @($rules | Where-Object { $_.DisplayName -eq $Name -and $_.Action -eq 'Allow' })
  $blocked = @($rules | Where-Object { $_.Action -eq 'Block' })
  if ($allowed.Count -eq 0 -or $blocked.Count -gt 0) { 'missing' } else { 'allowed' }
} catch {
  'unknown'
}
`;

/**
 * 查 mDNS（UDP 5353）那条规则，输出一个词：allowed / missing / unknown（含义同 CHECK_BODY）。
 * 和 CHECK_BODY 分开：只装过旧版、只有 TCP 规则的电脑上，本机接口照旧算放行，只是局域网共享不能自动发现。
 */
const CHECK_DISCOVERY_BODY = `
$ProgressPreference = 'SilentlyContinue'
try {
  ${IMPORT_MODULE}
  if (-not @(Get-NetFirewallProfile -ErrorAction Stop | Where-Object { $_.Enabled -eq 'True' }).Count) { 'allowed'; exit 0 }
  $rules = @(Get-NetFirewallApplicationFilter -Program $Program -ErrorAction SilentlyContinue |
    Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' })
  $mdns = @($rules | Where-Object { $_.DisplayName -eq $Name -and $_.Action -eq 'Allow' } |
    Where-Object { @($_ | Get-NetFirewallPortFilter | Where-Object { $_.Protocol -eq 'UDP' -and $_.LocalPort -eq '${MDNS_UDP_PORT}' }).Count -gt 0 })
  $blocked = @($rules | Where-Object { $_.Action -eq 'Block' })
  if ($mdns.Count -eq 0 -or $blocked.Count -gt 0) { 'missing' } else { 'allowed' }
} catch {
  'unknown'
}
`;

/** 安装包的 -Check：卸载时用，只看本程序的同名规则在不在。 */
const CHECK_EXISTS_FOR_INSTALLER = `
if ($Check) {
  ${IMPORT_MODULE}
  $found = @(Get-NetFirewallApplicationFilter -Program $Program -ErrorAction SilentlyContinue |
    Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq $Name })
  if ($found.Count -gt 0) { exit 0 } else { exit 1 }
}
`;

/** 程序里用：路径直接写进脚本（再整段 Base64 交给 -EncodedCommand，不经过命令行转义）。 */
export function firewallScript(action: FirewallAction, program: string): string {
  const variables = [`$Name = ${powerShellLiteral(FIREWALL_RULE_NAME)}`, `$Program = ${powerShellLiteral(program)}`];
  if (action === 'check') {
    return [...variables, CHECK_BODY].join('\n');
  }
  if (action === 'check-discovery') {
    return [...variables, CHECK_DISCOVERY_BODY].join('\n');
  }
  return [...variables, `$Remove = $${action === 'remove'}`, MUTATE_BODY].join('\n');
}

/**
 * 安装包带的 firewall.ps1：程序路径由参数传入（Windows 路径里没有双引号，安装脚本直接用双引号括起来）。
 * -Check：不改规则，只看本程序的放行规则在不在（在就退出码 0），卸载时先不提权查一下，没有就不弹管理员确认。
 * 安装脚本用 -Command 读取它再当作代码块运行，不用 -File：组策略设了执行策略时 -File 会被拦下。
 */
export function firewallInstallerScript(): string {
  return [
    'param([Parameter(Mandatory = $true)][string]$Program, [switch]$Remove, [switch]$Check)',
    `$Name = ${powerShellLiteral(FIREWALL_RULE_NAME)}`,
    CHECK_EXISTS_FOR_INSTALLER,
    MUTATE_BODY,
  ].join('\n');
}
