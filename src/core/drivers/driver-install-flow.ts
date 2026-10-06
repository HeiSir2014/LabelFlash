import type { Clock } from '../types';
import { type InstallTarget, installerFileName } from './install-plan';

export const INSTALL_STEPS = ['downloading', 'verifying', 'installing', 'finding-printer'] as const;
export type InstallStep = (typeof INSTALL_STEPS)[number];

export type InstallFailure =
  | 'download-failed'
  | 'download-timeout'
  | 'too-large'
  | 'canceled'
  | 'size-mismatch'
  | 'hash-mismatch'
  | 'signature-invalid'
  | 'signature-unverifiable'
  | 'signer-mismatch'
  | 'admin-declined'
  | 'installer-failed'
  | 'install-timeout'
  | 'internal';

export type InstallState =
  | { phase: 'running'; step: InstallStep; receivedBytes: number; totalBytes: number }
  /**
   * newPrinters：null 表示没找（重新安装一台已经有打印机队列的设备，见 runDriverInstall 的
   * searchForNewPrinter）；[] 表示找了但在超时内没看到新的；非空表示找到的新打印机名字。
   */
  | { phase: 'done'; newPrinters: string[] | null; needsRestart: boolean }
  /** exitCode：安装程序的退出码（只有 installer-failed 才有，提权脚本自己出错时为 null）。 */
  | { phase: 'failed'; failure: InstallFailure; exitCode: number | null };

/** 下载好的文件：大小和 SHA-256 是边下边算的。 */
export interface DownloadedFile {
  path: string;
  sizeBytes: number;
  /** 64 位小写十六进制。 */
  sha256: string;
}

export type DownloadFailure = 'download-failed' | 'download-timeout' | 'too-large' | 'canceled';

/** 下载失败：kind 决定给操作员看的原因，message 写日志。下载器失败时自己删掉已下的部分。 */
export class DownloadError extends Error {
  constructor(
    readonly kind: DownloadFailure,
    message: string,
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}

export interface InstallerDownloader {
  /** 下载到本程序自己的临时目录；超过 expectedBytes 立即停。失败抛 DownloadError。 */
  download(
    url: string,
    expectedBytes: number,
    fileName: string,
    onProgress: (receivedBytes: number) => void,
    signal: AbortSignal,
  ): Promise<DownloadedFile>;
  /** 删掉下载的文件和它的临时目录。 */
  discard(file: DownloadedFile): Promise<void>;
}

/**
 * valid：签名有效，signer 是签名证书的名字（Windows 的 Subject、macOS 证书链第一行）；
 * unverifiable：查询本身失败（例如 PowerShell 没能运行），不是「这份签名无效」——不能说「签名无效」，
 * 只能说核对不了，交给操作员看日志排查。
 */
export type SignatureCheck =
  | { status: 'valid'; signer: string }
  | { status: 'invalid'; detail: string }
  | { status: 'unverifiable'; detail: string };

export interface InstallerVerifier {
  check(file: DownloadedFile, target: InstallTarget): Promise<SignatureCheck>;
}

/** 提权安装的结果；hash-mismatch：提权后在管理员专属目录里复核哈希不一致（文件在核对之后被换过）。 */
export type PrivilegedOutcome =
  | { kind: 'installed'; needsRestart: boolean }
  | { kind: 'declined' }
  | { kind: 'failed'; exitCode: number | null }
  | { kind: 'timeout' }
  | { kind: 'hash-mismatch' };

export interface PrivilegedInstaller {
  install(file: DownloadedFile, target: InstallTarget): Promise<PrivilegedOutcome>;
}

export interface InstallFlowDeps {
  downloader: InstallerDownloader;
  verifier: InstallerVerifier;
  installer: PrivilegedInstaller;
  /** 系统打印机名单（装完比较前后，找出新打印机）。 */
  listPrinters: () => Promise<string[]>;
  sleep: (ms: number) => Promise<void>;
  clock: Clock;
  log: (line: string) => void;
}

/** 装完驱动后系统建打印机要几秒（重新枚举 USB 设备）；30 秒还没有就提示重新插拔。 */
export const FIND_PRINTER_TIMEOUT_MS = 30_000;
export const FIND_PRINTER_INTERVAL_MS = 2_000;

/**
 * 装一个驱动。不可信的下载在核对完大小、SHA-256（清单签过的值）和签名者之前绝不运行；
 * 运行由提权安装器负责，它在管理员专属目录里再核对一次哈希。下载的文件在任何结局下都删掉。
 * 每一步写日志（地址、大小、哈希、签名者、退出码，都不是秘密）。返回最终状态，也经 onState 推出。
 */
export async function runDriverInstall(
  target: InstallTarget,
  deps: InstallFlowDeps,
  onState: (state: InstallState) => void,
  signal: AbortSignal,
  /** false：重新安装一台已经有打印机队列的设备（5b 按驱动名重装）；跳过「找新打印机」这一步。 */
  searchForNewPrinter = true,
): Promise<InstallState> {
  const pkg = target.package;
  const label = `[drivers] ${target.model.id}`;
  const finish = (state: InstallState): InstallState => {
    onState(state);
    return state;
  };
  const fail = (failure: InstallFailure, exitCode: number | null = null): InstallState => {
    deps.log(`${label}: not installed (${failure}${exitCode === null ? '' : `, exit code ${exitCode}`})`);
    return finish({ phase: 'failed', failure, exitCode });
  };
  const running = (step: InstallStep, receivedBytes: number): void =>
    onState({ phase: 'running', step, receivedBytes, totalBytes: pkg.sizeBytes });

  const before = searchForNewPrinter ? await listOrNull(deps) : null;
  running('downloading', 0);
  deps.log(`${label}: downloading ${pkg.url} (${pkg.sizeBytes} bytes)`);
  let file: DownloadedFile;
  try {
    file = await deps.downloader.download(
      pkg.url,
      pkg.sizeBytes,
      installerFileName(target),
      (received) => running('downloading', received),
      signal,
    );
  } catch (error) {
    if (error instanceof DownloadError) {
      deps.log(`${label}: download stopped: ${error.message}`);
      return fail(error.kind);
    }
    deps.log(`${label}: download failed unexpectedly: ${describeError(error)}`);
    return fail('internal');
  }

  let needsRestart = false;
  try {
    if (signal.aborted) {
      return fail('canceled');
    }
    running('verifying', file.sizeBytes);
    deps.log(`${label}: downloaded ${file.sizeBytes} bytes, sha256 ${file.sha256}`);
    if (file.sizeBytes !== pkg.sizeBytes) {
      return fail('size-mismatch');
    }
    if (file.sha256 !== pkg.sha256) {
      return fail('hash-mismatch');
    }
    const signature = await deps.verifier.check(file, target);
    deps.log(`${label}: signature ${signatureLogText(signature)}`);
    if (signature.status === 'unverifiable') {
      return fail('signature-unverifiable');
    }
    if (signature.status !== 'valid') {
      return fail('signature-invalid');
    }
    if (signature.signer !== pkg.signer) {
      return fail('signer-mismatch');
    }
    if (signal.aborted) {
      return fail('canceled');
    }
    running('installing', file.sizeBytes);
    const outcome = await deps.installer.install(file, target);
    switch (outcome.kind) {
      case 'declined':
        return fail('admin-declined');
      case 'timeout':
        return fail('install-timeout');
      case 'hash-mismatch':
        return fail('hash-mismatch');
      case 'failed':
        return fail('installer-failed', outcome.exitCode);
      case 'installed':
        needsRestart = outcome.needsRestart;
        break;
    }
  } catch (error) {
    deps.log(`${label}: ${describeError(error)}`);
    return fail('internal');
  } finally {
    await deps.downloader
      .discard(file)
      .catch((error: unknown) => deps.log(`${label}: could not delete ${file.path}: ${describeError(error)}`));
  }

  if (!searchForNewPrinter) {
    deps.log(`${label}: installed${needsRestart ? ' (restart needed)' : ''}`);
    return finish({ phase: 'done', newPrinters: null, needsRestart });
  }
  running('finding-printer', pkg.sizeBytes);
  const newPrinters = before === null ? [] : await findNewPrinters(before, deps);
  deps.log(
    `${label}: installed${needsRestart ? ' (restart needed)' : ''}; new printers: ${newPrinters.join(', ') || 'none yet'}`,
  );
  return finish({ phase: 'done', newPrinters, needsRestart });
}

/** 装之前读不到打印机名单时不找新打印机（没法比较），只说驱动装好了。 */
async function findNewPrinters(before: ReadonlySet<string>, deps: InstallFlowDeps): Promise<string[]> {
  const startedAt = deps.clock.now();
  for (;;) {
    const added = [...((await listOrNull(deps)) ?? [])].filter((name) => !before.has(name));
    if (added.length > 0 || deps.clock.now() - startedAt >= FIND_PRINTER_TIMEOUT_MS) {
      return added;
    }
    await deps.sleep(FIND_PRINTER_INTERVAL_MS);
  }
}

async function listOrNull(deps: InstallFlowDeps): Promise<Set<string> | null> {
  try {
    return new Set(await deps.listPrinters());
  } catch (error) {
    deps.log(`[drivers] cannot list printers: ${describeError(error)}`);
    return null;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function signatureLogText(signature: SignatureCheck): string {
  switch (signature.status) {
    case 'valid':
      return `valid, signed by ${signature.signer}`;
    case 'unverifiable':
      return `could not be checked (${signature.detail})`;
    case 'invalid':
      return `invalid (${signature.detail})`;
  }
}
