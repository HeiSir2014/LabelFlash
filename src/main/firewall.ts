import { execFile } from 'node:child_process';
import { type FirewallOptions, firewallScript, powerShellLiteral } from '../shared/firewall-rule';
import { FIREWALL_STATES, type FirewallStatus } from '../shared/local-api';

/** 查规则最多等这么久：PowerShell 第一次加载防火墙模块要一两秒。 */
const CHECK_TIMEOUT_MS = 15_000;
/** 加规则要等操作员在管理员确认框里点选：给足时间，超时按「还没有」处理。 */
const ADD_TIMEOUT_MS = 120_000;
const DEFAULT_SYSTEM_ROOT = 'C:\\Windows';

export function parseFirewallCheck(output: string): FirewallStatus {
  const result = output.trim();
  return (FIREWALL_STATES as readonly string[]).includes(result) ? (result as FirewallStatus) : 'unknown';
}

/** 系统目录下的 PowerShell：不按名字在搜索路径里找（工作目录里可能被放了同名的假程序）。 */
export function powerShellPath(env: NodeJS.ProcessEnv): string {
  return `${env['SystemRoot'] ?? DEFAULT_SYSTEM_ROOT}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}

function encode(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/**
 * 以管理员身份运行加规则的脚本：外层 PowerShell 用 Start-Process -Verb RunAs 弹管理员确认，
 * 内层只拿到 Base64，程序路径不经过任何命令行转义。操作员拒绝时 Start-Process 报错，外层退出码不为 0。
 */
export function elevatedCommand(program: string, powerShell: string, options: FirewallOptions): string {
  const inner = encode(firewallScript('add', program, options));
  return [
    `$p = Start-Process ${powerShellLiteral(powerShell)} -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${inner}'`,
    'exit $p.ExitCode',
  ].join('; ');
}

function runPowerShell(args: string[], timeoutMs: number): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile(
      powerShellPath(process.env),
      ['-NoProfile', '-NonInteractive', ...args],
      { timeout: timeoutMs, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          console.warn(`[firewall] powershell failed: ${error.message} ${stderr.trim()}`);
        }
        resolve({ ok: error === null, stdout });
      },
    );
  });
}

/** 这台电脑的防火墙让不让局域网连进来。只有 Windows 查；其他平台为 unknown（界面不显示这一项，也不拦局域网）。 */
export async function firewallStatus(program: string): Promise<FirewallStatus> {
  if (process.platform !== 'win32') {
    return 'unknown';
  }
  const { ok, stdout } = await runPowerShell(
    ['-EncodedCommand', encode(firewallScript('check', program))],
    CHECK_TIMEOUT_MS,
  );
  return ok ? parseFirewallCheck(stdout) : 'unknown';
}

/** mDNS（UDP 5353）那条规则放行没有（局域网共享的自动发现）。只有 Windows 查；其他平台为 unknown。 */
export async function discoveryFirewallStatus(program: string): Promise<FirewallStatus> {
  if (process.platform !== 'win32') {
    return 'unknown';
  }
  const { ok, stdout } = await runPowerShell(
    ['-EncodedCommand', encode(firewallScript('check-discovery', program))],
    CHECK_TIMEOUT_MS,
  );
  return ok ? parseFirewallCheck(stdout) : 'unknown';
}

/**
 * 弹管理员确认，加只放行这个程序的入站规则：TCP 所有端口，打开了局域网共享时再加 UDP 5353（只限同一网段）。
 * 加之前会删掉本程序同名的旧规则，所以本机接口那边加规则时也要按共享开没开传 discovery，不然会把 mDNS 那条删掉。
 * 返回加完之后查到的 TCP 那条的状态。
 */
export async function addFirewallRule(program: string, options: FirewallOptions): Promise<FirewallStatus> {
  if (process.platform !== 'win32') {
    return 'unknown';
  }
  const { ok } = await runPowerShell(
    ['-Command', elevatedCommand(program, powerShellPath(process.env), options)],
    ADD_TIMEOUT_MS,
  );
  if (!ok) {
    console.warn('[firewall] the rule was not added (declined or failed)');
  }
  return firewallStatus(program);
}
