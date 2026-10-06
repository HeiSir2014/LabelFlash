import type { PrivilegedInstaller, PrivilegedOutcome, SignatureCheck } from '../../core/drivers/driver-install-flow';
import { type CommandResult, runFile } from './run-command';
import { INSTALL_TIMEOUT_MS } from './windows-install';

const SIGNATURE_TIMEOUT_MS = 30_000;
const C_LOCALE_ENV = { ...process.env, LC_ALL: 'C', LANG: 'C' };
/** pkgutil 认为是 Apple 签发的开发者证书（或 Apple 自己）签的；自签名、不受信任的都不算。 */
const TRUSTED_STATUS = /^\s*Status: signed (?:by a (?:developer )?certificate issued by Apple|Apple Software)/m;
const STATUS_LINE = /^\s*Status: (.+)$/m;
const LEAF_CERTIFICATE = /^\s*1\. (.+)$/m;
/** 提权脚本复核哈希不一致时的退出码（和 installer 的退出码 0 / 1 分开）。 */
export const MAC_HASH_MISMATCH_EXIT = 90;
/** 操作员在系统的管理员密码框里点了「取消」（AppleScript 的 userCanceledErr）。 */
const USER_CANCELED_ERROR = -128;
const TRAILING_ERROR_NUMBER = /\((-?\d+)\)\s*$/;

/**
 * 以 root 运行的固定脚本（$1 = 核对过的 pkg，$2 = 清单里的 SHA-256）：在 root 专属的新目录（mktemp -d，权限 700）
 * 里复制、复核哈希，一致才交给系统的 installer；结束时删掉目录。和 Windows 一样，保证装的就是清单签过的那份字节。
 */
export const MAC_INSTALL_SCRIPT = [
  'set -eu',
  'dir=$(/usr/bin/mktemp -d /private/tmp/cdl-labelflash-driver.XXXXXXXX)',
  `trap '/bin/rm -rf "$dir"' EXIT`,
  '/bin/cp "$1" "$dir/driver-installer.pkg"',
  'actual=$(/usr/bin/shasum -a 256 "$dir/driver-installer.pkg" | /usr/bin/cut -d " " -f 1)',
  `[ "$actual" = "$2" ] || exit ${MAC_HASH_MISMATCH_EXIT}`,
  '/usr/sbin/installer -pkg "$dir/driver-installer.pkg" -target /',
].join('\n');

/** 解析 `pkgutil --check-signature`：可信的签名 + 证书链第一行（叶证书）的名字。 */
export function parsePkgSignature(output: string): SignatureCheck {
  const status = STATUS_LINE.exec(output)?.[1]?.trim() ?? 'unreadable';
  const leaf = LEAF_CERTIFICATE.exec(output)?.[1]?.trim();
  return TRUSTED_STATUS.test(output) && leaf !== undefined
    ? { status: 'valid', signer: leaf }
    : { status: 'invalid', detail: status };
}

export async function checkMacSignature(path: string): Promise<SignatureCheck> {
  // 没签名时 pkgutil 退出码不为 0，输出照样有 Status 行，一律按输出判断。
  const result = await runFile('/usr/sbin/pkgutil', ['--check-signature', path], {
    timeoutMs: SIGNATURE_TIMEOUT_MS,
    env: C_LOCALE_ENV,
  });
  return parsePkgSignature(result.stdout);
}

/**
 * osascript 的参数：AppleScript 用 `on run argv` 收下脚本、pkg 路径和哈希，经 `quoted form of` 转义后交给
 * `do shell script … with administrator privileges`（系统标准的管理员密码框）。路径和哈希不拼进 AppleScript 字符串。
 * 为什么用 osascript：Electron 没有提权执行的接口；AuthorizationExecuteWithPrivileges 已废弃；
 * SMJobBless 要正式签名的辅助程序，我们的程序是 ad-hoc 签名。
 */
export function osascriptArgs(pkgPath: string, sha256: string): string[] {
  return [
    '-e',
    'on run argv',
    '-e',
    'do shell script "/bin/sh -c " & quoted form of (item 1 of argv) & " sh " & quoted form of (item 2 of argv) & " " & quoted form of (item 3 of argv) with administrator privileges',
    '-e',
    'end run',
    MAC_INSTALL_SCRIPT,
    pkgPath,
    sha256,
  ];
}

/** osascript 失败时错误号在 stderr 末尾的括号里：-128 是取消，其余是脚本的退出码。 */
export function interpretOsascript(result: CommandResult): PrivilegedOutcome {
  if (result.timedOut) {
    return { kind: 'timeout' };
  }
  if (result.exitCode === 0) {
    return { kind: 'installed', needsRestart: false };
  }
  const code = Number(TRAILING_ERROR_NUMBER.exec(result.stderr.trim())?.[1]);
  if (code === USER_CANCELED_ERROR) {
    return { kind: 'declined' };
  }
  if (code === MAC_HASH_MISMATCH_EXIT) {
    return { kind: 'hash-mismatch' };
  }
  return { kind: 'failed', exitCode: Number.isInteger(code) ? code : null };
}

export function createMacInstaller(log: (line: string) => void): PrivilegedInstaller {
  return {
    async install(file, target) {
      if (target.platform !== 'mac') {
        throw new Error(`The macOS installer cannot install a ${target.platform} package`);
      }
      const result = await runFile('/usr/bin/osascript', osascriptArgs(file.path, target.package.sha256), {
        timeoutMs: INSTALL_TIMEOUT_MS,
      });
      log(`[drivers] ${target.model.id}: osascript finished with exit ${result.exitCode}: ${result.stderr.trim()}`);
      return interpretOsascript(result);
    },
  };
}
