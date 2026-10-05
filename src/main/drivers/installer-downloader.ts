import { createHash } from 'node:crypto';
import { mkdtemp, open, readdir, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { DownloadError, type DownloadFailure, type InstallerDownloader } from '../../core/drivers/driver-install-flow';
import type { FetchFunction } from './catalog-client';

/** 整个下载最多 30 分钟：最大 512MB，按 4Mbps 的店铺宽带约 17 分钟，留出余量。 */
export const DOWNLOAD_TOTAL_TIMEOUT_MS = 30 * 60_000;
/** 60 秒没有收到任何数据就当断线：网络慢时数据会一直来，只是慢。 */
export const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;
/** 每次下载一个新的临时目录；discard 和启动时的清理都只认这个前缀。 */
export const TEMP_DIR_PREFIX = 'cdl-labelflash-driver-';

export interface DownloaderDeps {
  /** 生产环境是 Electron 的 net.fetch（走系统代理）；E2E 换成内存里的假文件。 */
  fetch: FetchFunction;
  /** 系统临时目录（app.getPath('temp')）。 */
  tempRoot: string;
  userAgent: string;
  idleTimeoutMs?: number;
  totalTimeoutMs?: number;
}

/**
 * 安装包下载：只接受 https（跳转后也是）；服务器声明的大小或实际收到的字节超过清单写的大小立即停；
 * 边写文件边算 SHA-256（不把整个安装包读进内存）；失败或取消时删掉这次的临时目录。
 */
export function createInstallerDownloader(deps: DownloaderDeps): InstallerDownloader {
  return {
    async download(url, expectedBytes, fileName, onProgress, signal) {
      if (!isHttps(url)) {
        throw new DownloadError('download-failed', `not an https address: ${url}`);
      }
      const dir = await mkdtemp(join(deps.tempRoot, TEMP_DIR_PREFIX));
      const path = join(dir, fileName);
      try {
        const { sizeBytes, sha256 } = await fetchToFile(url, expectedBytes, path, onProgress, signal, deps);
        return { path, sizeBytes, sha256 };
      } catch (error) {
        await rm(dir, { recursive: true, force: true });
        throw error;
      }
    },
    async discard(file) {
      const dir = dirname(file.path);
      // 只删自己建的临时目录：路径来自内部，但删除是不可逆的，多核对一下。
      if (dirname(dir) !== deps.tempRoot || !basename(dir).startsWith(TEMP_DIR_PREFIX)) {
        throw new Error(`Refusing to delete ${dir}: not a driver download folder`);
      }
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/**
 * 启动时清一遍上次没清干净的下载临时目录：程序被强制结束（崩溃、被杀、断电）时，正常流程里的
 * discard() 没机会跑，残留的目录会一直占着系统临时目录。这些目录是本程序自己建的、在系统临时目录下，
 * 删除不需要用户同意（项目「删除前先征得同意」的规则针对用户数据、安装目录和更新缓存，不包括这里）。
 * 只删前缀匹配的目录，不动同目录下别的文件；读不到目录或删不掉某一个都不报错，不挡启动。
 */
export async function cleanupOldDownloads(
  tempRoot: string,
  log: (line: string) => void = () => undefined,
): Promise<void> {
  let entries: string[];
  try {
    entries = (await readdir(tempRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(TEMP_DIR_PREFIX))
      .map((entry) => entry.name);
  } catch (error) {
    log(`[drivers] could not list ${tempRoot} to clean up old downloads: ${describeError(error)}`);
    return;
  }
  await Promise.all(
    entries.map(async (name) => {
      const dir = join(tempRoot, name);
      try {
        await rm(dir, { recursive: true, force: true });
        log(`[drivers] removed a leftover download folder from a previous run: ${dir}`);
      } catch (error) {
        log(`[drivers] could not remove leftover folder ${dir}: ${describeError(error)}`);
      }
    }),
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchToFile(
  url: string,
  expectedBytes: number,
  path: string,
  onProgress: (receivedBytes: number) => void,
  signal: AbortSignal,
  deps: DownloaderDeps,
): Promise<{ sizeBytes: number; sha256: string }> {
  const controller = new AbortController();
  let stopReason: DownloadFailure | null = null;
  const stop = (reason: DownloadFailure) => {
    stopReason ??= reason;
    controller.abort();
  };
  const onCancel = () => stop('canceled');
  signal.addEventListener('abort', onCancel, { once: true });
  const total = setTimeout(() => stop('download-timeout'), deps.totalTimeoutMs ?? DOWNLOAD_TOTAL_TIMEOUT_MS);
  const idleMs = deps.idleTimeoutMs ?? DOWNLOAD_IDLE_TIMEOUT_MS;
  let idle = setTimeout(() => stop('download-timeout'), idleMs);
  // wx：文件已存在就失败（新建的临时目录里不该有）。
  const handle = await open(path, 'wx');
  const hash = createHash('sha256');
  let received = 0;
  try {
    const response = await deps.fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': deps.userAgent },
    });
    if (!isHttps(response.url || url)) {
      throw new DownloadError('download-failed', `redirected to a non-https address: ${response.url}`);
    }
    if (!response.ok) {
      throw new DownloadError('download-failed', `HTTP ${response.status}`);
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > expectedBytes) {
      throw new DownloadError('too-large', `the server announced ${declared} bytes, the catalog says ${expectedBytes}`);
    }
    const reader = response.body?.getReader();
    if (!reader) {
      throw new DownloadError('download-failed', 'empty response');
    }
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      received += value.byteLength;
      if (received > expectedBytes) {
        await reader.cancel();
        throw new DownloadError('too-large', `received more than the ${expectedBytes} bytes in the catalog`);
      }
      hash.update(value);
      await handle.write(value);
      clearTimeout(idle);
      idle = setTimeout(() => stop('download-timeout'), idleMs);
      onProgress(received);
    }
  } catch (error) {
    if (error instanceof DownloadError) {
      throw error;
    }
    if (stopReason !== null) {
      throw new DownloadError(stopReason, `stopped after ${received} bytes (${stopReason})`);
    }
    throw new DownloadError('download-failed', error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(total);
    clearTimeout(idle);
    signal.removeEventListener('abort', onCancel);
    await handle.close();
  }
  return { sizeBytes: received, sha256: hash.digest('hex') };
}

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
