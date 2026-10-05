import { execFile } from 'node:child_process';
import { powerShellPath } from '../firewall';

export interface CommandResult {
  /** 进程的退出码；没能启动、被信号结束时为 null。 */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** 命令输出最多 4MB：设备列表、签名信息都只有几 KB，system_profiler 的 USB 树也不到 1MB。 */
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/** 运行系统命令：参数按数组传，不经过 shell；失败不抛错，交给调用方按退出码判断。 */
export function runFile(
  file: string,
  args: readonly string[],
  options: { timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      [...args],
      {
        timeout: options.timeoutMs,
        windowsHide: true,
        maxBuffer: MAX_OUTPUT_BYTES,
        encoding: 'utf8',
        env: options.env,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ exitCode: 0, stdout, stderr, timedOut: false });
          return;
        }
        resolve({
          exitCode: typeof error.code === 'number' ? error.code : null,
          stdout,
          stderr,
          timedOut: error.killed === true && error.signal === 'SIGTERM',
        });
      },
    );
  });
}

/** -EncodedCommand 要 UTF-16LE 的 base64：多行脚本原样传入，不受命令行引号转义影响，中文也不乱码。 */
export function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/** 系统目录下的 PowerShell（不按名字在搜索路径里找），整段脚本 Base64 传入。 */
export function runPowerShell(script: string, timeoutMs: number): Promise<CommandResult> {
  return runFile(
    powerShellPath(process.env),
    ['-NoProfile', '-NonInteractive', '-NoLogo', '-EncodedCommand', encodePowerShell(script)],
    { timeoutMs },
  );
}
