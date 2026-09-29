import { execFile } from 'node:child_process';

/** 查一次最多等这么久：只在端口都被占用时查，查不到就不显示程序名。 */
const OWNER_QUERY_TIMEOUT_MS = 5_000;

/** PowerShell 输出的第一行就是进程名。 */
export function parsePowerShellOwner(output: string): string | null {
  const name = output.split(/\r?\n/)[0]?.trim() ?? '';
  return name === '' ? null : name;
}

/** lsof -F pc 的输出里，以 c 开头的一行是命令名。 */
export function parseLsofOwner(output: string): string | null {
  const line = output.split('\n').find((item) => item.startsWith('c'));
  return line === undefined || line.length === 1 ? null : line.slice(1);
}

function run(file: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: OWNER_QUERY_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
      if (error) {
        console.warn(`[api] cannot find the owner of the port: ${error.message}`);
        resolve(null);
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * 占着这个端口监听的程序名；查不到返回 null。参数按数组传入、不经过 shell，端口是校验过的整数。
 * - Windows：Get-NetTCPConnection 查进程号，再取进程名；
 * - macOS：lsof。
 */
export async function findPortOwner(port: number): Promise<string | null> {
  if (!Number.isInteger(port)) {
    return null;
  }
  switch (process.platform) {
    case 'win32': {
      const script = `(Get-Process -Id (Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction Stop | Select-Object -First 1).OwningProcess).ProcessName`;
      const output = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
      return output === null ? null : parsePowerShellOwner(output);
    }
    case 'darwin': {
      const output = await run('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc']);
      return output === null ? null : parseLsofOwner(output);
    }
    default:
      return null;
  }
}
