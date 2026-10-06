import {
  DownloadError,
  type DownloadedFile,
  type InstallerDownloader,
  type InstallerVerifier,
  type PrivilegedInstaller,
  type PrivilegedOutcome,
  type SignatureCheck,
} from '../drivers/driver-install-flow';
import { EXAMPLE_SHA256 } from './driver-catalog-fixtures';

/** 和示例清单的 Windows 安装包一致（大小、SHA-256）。 */
export const FAKE_DOWNLOAD: DownloadedFile = {
  path: '/tmp/cdl-labelflash-driver-test/driver-installer.exe',
  sizeBytes: 1_048_576,
  sha256: EXAMPLE_SHA256,
};

/** 假下载：先报几次进度，再返回结果或抛出 DownloadError；afterDownload 用来模拟下载完的那一刻操作员点了取消。 */
export class FakeDownloader implements InstallerDownloader {
  readonly discarded: string[] = [];

  constructor(
    private readonly result: DownloadedFile | DownloadError,
    private readonly progress: readonly number[] = [],
    private readonly afterDownload: () => void = () => undefined,
  ) {}

  async download(
    _url: string,
    _expectedBytes: number,
    _fileName: string,
    onProgress: (receivedBytes: number) => void,
  ): Promise<DownloadedFile> {
    for (const received of this.progress) {
      onProgress(received);
    }
    if (this.result instanceof DownloadError) {
      throw this.result;
    }
    this.afterDownload();
    return this.result;
  }

  async discard(file: DownloadedFile): Promise<void> {
    this.discarded.push(file.path);
  }
}

/** afterCheck 用来模拟核对签名的那一刻操作员点了取消（check() 返回之前触发）。 */
export class FakeVerifier implements InstallerVerifier {
  readonly checked: string[] = [];

  constructor(
    private readonly result: SignatureCheck,
    private readonly afterCheck: () => void = () => undefined,
  ) {}

  async check(file: DownloadedFile): Promise<SignatureCheck> {
    this.checked.push(file.path);
    this.afterCheck();
    return this.result;
  }
}

export class FakeInstaller implements PrivilegedInstaller {
  readonly installed: string[] = [];

  constructor(private readonly outcome: PrivilegedOutcome) {}

  async install(file: DownloadedFile): Promise<PrivilegedOutcome> {
    this.installed.push(file.path);
    return this.outcome;
  }
}

/** 依次返回这几份打印机名单，最后一份一直返回。 */
export class FakePrinterList {
  constructor(private readonly sequence: string[][]) {}

  readonly list = async (): Promise<string[]> =>
    (this.sequence.length > 1 ? this.sequence.shift() : this.sequence[0]) ?? [];
}
