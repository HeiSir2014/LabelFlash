import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type FakeDriverSpec, TEST_CATALOG_KEY_ID } from '../../src/main/drivers/fake-drivers';
import {
  createTestCatalogKeys,
  signedCatalogText,
  type TestCatalogKeys,
} from '../../src/main/drivers/testing/catalog-keys';
import type { PnpRecord } from '../../src/main/drivers/windows-devices';
import type { FakePrinterSpec } from '../../src/main/printing/fake-printers';

/** 品牌、地址都是假的（仓库里不写真实品牌和厂家网址）；example.invalid 的下载由假驱动环境从内存提供。 */
export const INSTALLER_URL = 'https://example.invalid/drivers/x1-setup.exe';
export const INSTALLER_BYTES = Buffer.from('MZ 示例安装包（E2E）');
export const SIGNER = 'CN=示例品牌有限公司, O=示例品牌有限公司, C=CN';
export const NEW_PRINTER: FakePrinterSpec = {
  name: '示例标签机',
  paper: { widthMm: 60, heightMm: 40, dpi: 203 },
  readiness: { ready: true },
};
const MS_PER_SECOND = 1_000;
const MS_PER_DAY = 86_400_000;
/** 测试清单的有效期：够一次测试用，过期的另造。 */
const VALID_DAYS = 30;
const PRINTER_CLASS = ['USB\\Class_07&SubClass_01&Prot_02', 'USB\\Class_07'];

/** 清单里有的型号（1234:ABCD）。 */
export const CATALOG_DEVICE: PnpRecord = {
  instanceId: 'USB\\VID_1234&PID_ABCD\\E2E0001',
  name: '未知设备',
  pnpClass: '',
  problemCode: 28,
  compatibleIds: PRINTER_CLASS,
  parentId: '',
};
/** 清单里没有、但系统认得是打印机的设备（9999:0001）。 */
export const UNKNOWN_PRINTER_DEVICE: PnpRecord = {
  ...CATALOG_DEVICE,
  instanceId: 'USB\\VID_9999&PID_0001\\E2E0002',
  name: 'USB 打印支持',
};

export function e2eCatalogKeys(): TestCatalogKeys {
  return createTestCatalogKeys(TEST_CATALOG_KEY_ID);
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function catalogModel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'example-x1',
    brand: '示例品牌',
    model: '示例型号 X1',
    usb: [{ vendorId: '1234', productId: 'ABCD' }],
    driverNames: ['示例品牌 X1'],
    commandSet: 'tspl',
    windows: {
      url: INSTALLER_URL,
      sizeBytes: INSTALLER_BYTES.length,
      sha256: sha256Hex(INSTALLER_BYTES),
      kind: 'exe',
      silentArgs: ['/S'],
      signer: SIGNER,
    },
    ...overrides,
  };
}

/** 签好的清单原文；signedAt 往前挪可以造出过期的清单。 */
export function catalogText(keys: TestCatalogKeys, models: unknown[], signedAt = Date.now()): string {
  return signedCatalogText(
    {
      schema: 1,
      version: Math.floor(signedAt / MS_PER_SECOND),
      issuedAt: new Date(signedAt).toISOString(),
      expiresAt: new Date(signedAt + VALID_DAYS * MS_PER_DAY).toISOString(),
      models,
    },
    keys,
  );
}

export function fakeDrivers(overrides: Partial<FakeDriverSpec> = {}): FakeDriverSpec {
  return {
    devices: [CATALOG_DEVICE, UNKNOWN_PRINTER_DEVICE],
    files: { [INSTALLER_URL]: INSTALLER_BYTES.toString('base64') },
    authenticode: { status: 'Valid', subject: SIGNER },
    installExitCode: 0,
    printerAfterInstall: NEW_PRINTER,
    ...overrides,
  };
}

/** 本机 HTTP 服务提供清单（清单地址允许本机的 http；内容照样验签）。 */
export async function serveCatalog(body: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/driver-catalog.json`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
