import { spawn } from 'node:child_process';

/** 一次命令的结果。exitCode 为 null：没启动起来、被超时杀掉或输出超限。 */
export interface CommandRun {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface RunOptions {
  timeoutMs: number;
  /** stdout 和 stderr 加起来的上限：命令输出不可信，超过就杀掉、整个不要。 */
  maxOutputBytes: number;
}

/**
 * 跑一个系统命令：参数数组、不经过 shell；stdin 关掉、独立会话（detached）——CUPS 命令要密码时会去控制终端上问，
 * 开发版从终端启动时会一直等；没有终端就直接失败，我们据此换成管理员按钮。
 */
export function runCommand(
  file: string,
  args: readonly string[],
  { timeoutMs, maxOutputBytes }: RunOptions,
  env: NodeJS.ProcessEnv,
): Promise<CommandRun> {
  return new Promise((resolve) => {
    const child = spawn(file, [...args], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true, windowsHide: true });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    let isOverflow = false;
    let timedOut = false;
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxOutputBytes) {
        isOverflow = true;
        child.kill();
        return;
      }
      target.push(chunk);
    };
    child.stdout.on('data', collect(out));
    child.stderr.on('data', collect(err));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout: '', stderr: error.message, timedOut: false });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (isOverflow) {
        resolve({ exitCode: null, stdout: '', stderr: `output exceeded ${maxOutputBytes} bytes`, timedOut });
        return;
      }
      resolve({
        exitCode: timedOut ? null : code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        timedOut,
      });
    });
  });
}
