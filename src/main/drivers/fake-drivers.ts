import { setTimeout as sleep } from 'node:timers/promises';
import type { CatalogModel } from '../../core/drivers/catalog-model';
import type { InstallerVerifier, PrivilegedInstaller } from '../../core/drivers/driver-install-flow';
import { isSameUsbId, parseWindowsUsbInstanceId } from '../../core/drivers/usb-id';
import type { FakePrinterSpec, FakePrinters } from '../printing/fake-printers';
import type { FetchFunction } from './catalog-client';
import type { DeviceSource } from './driver-station';
import { type PnpRecord, windowsDriverlessDevices } from './windows-devices';
import { interpretInstallExit } from './windows-install';
import { parseAuthenticode } from './windows-signature';

/**
 * 仅开发 / E2E：假的缺驱动设备、安装包下载、签名核对和提权安装（和 CDL_LABELFLASH_FAKE_PRINTERS 一样，安装版忽略）。
 * 清单照样从本机的 HTTP 服务真实下载、真实验签；测试公钥经 DRIVER_CATALOG_TEST_KEY_ENV 传入。
 * 假模式一律走 Windows 的流程（macOS 的 CI 上也能跑）。
 */
export const FAKE_DRIVERS_ENV = 'CDL_LABELFLASH_FAKE_DRIVERS';
export const DRIVER_CATALOG_TEST_KEY_ENV = 'CDL_LABELFLASH_DRIVER_CATALOG_TEST_KEY';
export const TEST_CATALOG_KEY_ID = 'e2e';

export interface FakeDriverSpec {
  /** 和 Windows 查询脚本输出一样的记录。 */
  devices: PnpRecord[];
  /** 下载地址 → 文件内容（base64）。 */
  files: Record<string, string>;
  /** 假的 Get-AuthenticodeSignature 结果。 */
  authenticode: { status: string; subject: string };
  /** 假的提权安装的退出码（按 interpretInstallExit 解释，可以用 ELEVATED_EXIT 模拟拒绝）。 */
  installExitCode: number;
  /** 提权安装要花多久（视觉验收截「正在安装」用）。 */
  installDelayMs?: number;
  /** 装好之后系统里多出的打印机；要和 CDL_LABELFLASH_FAKE_PRINTERS 一起用。 */
  printerAfterInstall: FakePrinterSpec | null;
}

export function parseFakeDrivers(env: Record<string, string | undefined>, isPackaged: boolean): FakeDriverSpec | null {
  const value = env[FAKE_DRIVERS_ENV];
  if (isPackaged || value === undefined) {
    return null;
  }
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { devices?: unknown }).devices)) {
    throw new Error(
      `${FAKE_DRIVERS_ENV} must be a JSON object of { devices, files, authenticode, installExitCode, printerAfterInstall }`,
    );
  }
  return parsed as FakeDriverSpec;
}

/** 额外信任的测试公钥（只对未打包的程序生效）。 */
export function testCatalogKey(env: Record<string, string | undefined>, isPackaged: boolean): Record<string, string> {
  const value = env[DRIVER_CATALOG_TEST_KEY_ENV];
  return isPackaged || value === undefined ? {} : { [TEST_CATALOG_KEY_ID]: value };
}

export class FakeDrivers {
  /** 交给假提权安装的文件（E2E 据此确认核对不过的安装包没有被运行）。 */
  readonly installs: string[] = [];
  private devices: PnpRecord[];

  constructor(
    private readonly spec: FakeDriverSpec,
    private readonly printers: FakePrinters | null,
  ) {
    this.devices = [...spec.devices];
  }

  deviceSource(): DeviceSource {
    return { detect: async () => windowsDriverlessDevices(this.devices) };
  }

  fetch(): FetchFunction {
    return async (url) => {
      const base64 = this.spec.files[url];
      if (base64 === undefined) {
        return new Response('not found', { status: 404 });
      }
      const bytes = Buffer.from(base64, 'base64');
      return new Response(bytes, { headers: { 'Content-Length': String(bytes.length) } });
    };
  }

  verifier(): InstallerVerifier {
    return { check: async () => parseAuthenticode(JSON.stringify(this.spec.authenticode)) };
  }

  installer(): PrivilegedInstaller {
    return {
      install: async (file, target) => {
        if (this.spec.installDelayMs !== undefined) {
          await sleep(this.spec.installDelayMs);
        }
        this.installs.push(file.path);
        const successCodes = target.platform === 'windows' ? target.package.successExitCodes : [0];
        const outcome = interpretInstallExit({ exitCode: this.spec.installExitCode, timedOut: false }, successCodes);
        if (outcome.kind === 'installed') {
          this.devices = this.devices.filter((record) => !isFor(record, target.model));
          if (this.spec.printerAfterInstall && this.printers) {
            this.printers.add(this.spec.printerAfterInstall);
          }
        }
        return outcome;
      },
    };
  }
}

function isFor(record: PnpRecord, model: CatalogModel): boolean {
  const id = parseWindowsUsbInstanceId(record.instanceId) ?? parseWindowsUsbInstanceId(record.parentId);
  return id !== null && model.usb.some((item) => isSameUsbId(item, id));
}
