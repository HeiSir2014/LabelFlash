import type { DriverCatalog } from '../drivers/catalog-model';
import { sanitizeCatalog } from '../drivers/sanitize-catalog';

/**
 * 测试用的清单：品牌、型号、地址都是假的（仓库里不写真实品牌和厂家网址）。
 * 有效期覆盖 FakeClock 的起点（2026-09-28）。
 */
export const EXAMPLE_SHA256 = '0123456789abcdef'.repeat(4);
export const EXAMPLE_SIGNER = 'CN=示例品牌有限公司, O=示例品牌有限公司, C=CN';
export const EXAMPLE_ISSUED_AT = '2026-09-01T00:00:00Z';
export const EXAMPLE_EXPIRES_AT = '2027-03-01T00:00:00Z';
/** 签名时刻 2026-09-01 的 Unix 秒数。 */
export const EXAMPLE_VERSION = 1_788_220_800;

export function exampleModelSource(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'example-x1',
    brand: '示例品牌',
    model: '示例型号 X1',
    usb: [{ vendorId: '1234', productId: 'ABCD' }],
    driverNames: ['示例品牌 X1'],
    commandSet: 'tspl',
    windows: {
      url: 'https://example.invalid/drivers/x1-setup.exe',
      sizeBytes: 1_048_576,
      sha256: EXAMPLE_SHA256,
      kind: 'exe',
      silentArgs: ['/S'],
      signer: EXAMPLE_SIGNER,
    },
    macos: { downloadPage: 'https://example.invalid/drivers/x1-mac' },
    ...overrides,
  };
}

export function exampleCatalogSource(
  models: unknown[] = [exampleModelSource()],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema: 1,
    version: EXAMPLE_VERSION,
    issuedAt: EXAMPLE_ISSUED_AT,
    expiresAt: EXAMPLE_EXPIRES_AT,
    models,
    ...overrides,
  };
}

export function exampleCatalog(models?: unknown[]): DriverCatalog {
  const parsed = sanitizeCatalog(exampleCatalogSource(models));
  if (!parsed.ok) {
    throw new Error(`example catalog is invalid: ${parsed.issue}`);
  }
  return parsed.catalog;
}
