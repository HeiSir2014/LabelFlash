import { execFile } from 'node:child_process';
import { powerShellLiteral } from '../shared/firewall-rule';
import { powerShellPath } from './firewall';

/**
 * 管理员确认没有成：外层脚本接住 Start-Process 的异常，用 Windows 的 ERROR_CANCELLED 退出。
 * 操作员点「否」是最常见的原因；系统没能弹出确认框也走这里，提示里两种都说到。
 */
export const ELEVATION_DECLINED_EXIT_CODE = 1223;
/** Windows 命令行的长度上限（32767 个字符）留出余量：外层命令超过它就是内层脚本写得太大。 */
export const MAX_ELEVATED_COMMAND_LENGTH = 30_000;
/** 诊断脚本的输出很短（一个数字或一行英文错误）；1MB 是硬上限。 */
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_LOGGED_STDERR = 500;

/** 一次 PowerShell 的结果。exitCode 为 null：没启动起来或被超时杀掉。 */
export interface PowerShellRun {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** -EncodedCommand 要 UTF-16LE 的 Base64：多行脚本、中文打印机名原样传入，不经过命令行转义。 */
export function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/**
 * 以管理员身份运行一段脚本（和 firewall.ts 同样的做法）：外层用 Start-Process -Verb RunAs 弹 UAC，
 * 内层只拿到 Base64；外层把内层的退出码原样带回来，确认框没成时退出 1223。
 */
export function elevatedPowerShellCommand(innerScript: string, powerShell: string): string {
  const command = [
    `try { $p = Start-Process ${powerShellLiteral(powerShell)} -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encodePowerShell(innerScript)}' } catch { exit ${ELEVATION_DECLINED_EXIT_CODE} }`,
    'exit $p.ExitCode',
  ].join('; ');
  if (command.length > MAX_ELEVATED_COMMAND_LENGTH) {
    throw new Error(`Elevated PowerShell command is too long: ${command.length} characters`);
  }
  return command;
}

/** 跑系统目录下的 powershell.exe（不按名字在搜索路径里找）；出错写日志，结果原样交回。 */
export function runPowerShell(args: readonly string[], timeoutMs: number): Promise<PowerShellRun> {
  return new Promise((resolve) => {
    execFile(
      powerShellPath(process.env),
      ['-NoProfile', '-NonInteractive', ...args],
      { timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          console.warn(`[powershell] ${error.message} ${String(stderr).trim().slice(0, MAX_LOGGED_STDERR)}`);
        }
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : null;
        resolve({ exitCode: code, stdout: String(stdout), stderr: String(stderr), timedOut: error?.killed === true });
      },
    );
  });
}

export function runPowerShellScript(script: string, timeoutMs: number): Promise<PowerShellRun> {
  return runPowerShell(['-EncodedCommand', encodePowerShell(script)], timeoutMs);
}

export function runElevatedPowerShellScript(script: string, timeoutMs: number): Promise<PowerShellRun> {
  return runPowerShell(['-Command', elevatedPowerShellCommand(script, powerShellPath(process.env))], timeoutMs);
}
