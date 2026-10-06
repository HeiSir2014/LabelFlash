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

/**
 * 去掉 PSModulePath：这台电脑上如果另外装过一套 PowerShell（例如 PowerShell 7），它的模块路径可能排在
 * Windows PowerShell 5.1 自己的模块路径前面；5.1 的内置模块（例如 Get-AuthenticodeSignature 所在的
 * Microsoft.PowerShell.Security）按名字自动加载时会先找到那个版本不兼容的模块而加载失败，报错但退出码
 * 未必是 0 以外的「我们认识的」失败（2026-10-05 在开发机上实测复现）。去掉这个环境变量后，PowerShell
 * 自己用内置的默认模块路径（含系统目录下的 WindowsPowerShell\v1.0\Modules），不受外部环境影响。
 * 这是所有调用 runPowerShell 的脚本共用的问题（设备检测、签名核对、提权安装的外层脚本），
 * 所以在这个共用的函数里统一处理，不是哪一个脚本自己的事。
 */
export function withoutPSModulePath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { PSModulePath: _ignored, ...rest } = env;
  return rest;
}

/** 系统目录下的 PowerShell（不按名字在搜索路径里找），整段脚本 Base64 传入。 */
export function runPowerShell(script: string, timeoutMs: number): Promise<CommandResult> {
  return runFile(
    powerShellPath(process.env),
    ['-NoProfile', '-NonInteractive', '-NoLogo', '-EncodedCommand', encodePowerShell(script)],
    { timeoutMs, env: withoutPSModulePath(process.env) },
  );
}
