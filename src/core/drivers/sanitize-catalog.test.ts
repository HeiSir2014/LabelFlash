import { describe, expect, test } from 'bun:test';
import { EXAMPLE_SHA256, exampleCatalogSource, exampleModelSource } from '../testing/driver-catalog-fixtures';
import { CATALOG_LIMITS } from './catalog-model';
import { sanitizeCatalog } from './sanitize-catalog';

function windowsOf(model: Record<string, unknown>): Record<string, unknown> {
  return model['windows'] as Record<string, unknown>;
}

describe('sanitizeCatalog', () => {
  test('keeps a valid model and normalizes its fields', () => {
    const model = exampleModelSource();
    windowsOf(model)['sha256'] = EXAMPLE_SHA256.toUpperCase();
    const result = sanitizeCatalog(exampleCatalogSource([model]));
    if (!result.ok) {
      throw new Error(result.issue);
    }
    expect(result.dropped).toEqual([]);
    expect(result.catalog.models).toEqual([
      {
        id: 'example-x1',
        brand: '示例品牌',
        model: '示例型号 X1',
        usb: [{ vendorId: 0x1234, productId: 0xabcd }],
        driverNames: ['示例品牌 X1'],
        commandSet: 'tspl',
        windows: {
          url: 'https://example.invalid/drivers/x1-setup.exe',
          sizeBytes: 1_048_576,
          sha256: EXAMPLE_SHA256,
          kind: 'exe',
          silentArgs: ['/S'],
          signer: 'CN=示例品牌有限公司, O=示例品牌有限公司, C=CN',
          successExitCodes: [0],
        },
        macos: { pkg: null, downloadPage: 'https://example.invalid/drivers/x1-mac' },
      },
    ]);
  });

  test('tells the operator to update the app when the catalog uses a newer schema', () => {
    expect(sanitizeCatalog(exampleCatalogSource(undefined, { schema: 2 }))).toEqual({
      ok: false,
      issue: '驱动清单的格式比这个版本的程序新：请更新程序',
    });
  });

  test('refuses a catalog that expires before it was issued', () => {
    expect(sanitizeCatalog(exampleCatalogSource(undefined, { expiresAt: '2026-08-01T00:00:00Z' }))).toMatchObject({
      ok: false,
    });
  });

  test('drops a model whose installer is not downloaded over https', () => {
    const model = exampleModelSource();
    windowsOf(model)['url'] = 'http://example.invalid/x1.exe';
    const result = sanitizeCatalog(exampleCatalogSource([model]));
    expect(result).toMatchObject({ ok: true, catalog: { models: [] } });
    expect(result.ok ? result.dropped[0] : '').toContain('Windows 驱动');
  });

  test('drops a model whose silent arguments could carry another command', () => {
    const model = exampleModelSource();
    windowsOf(model)['silentArgs'] = ['/S', '& calc.exe'];
    expect(sanitizeCatalog(exampleCatalogSource([model]))).toMatchObject({ ok: true, catalog: { models: [] } });
  });

  test('drops the second model with the same id', () => {
    const result = sanitizeCatalog(
      exampleCatalogSource([exampleModelSource(), exampleModelSource({ model: '示例型号 X2' })]),
    );
    expect(result).toMatchObject({
      ok: true,
      catalog: { models: [{ model: '示例型号 X1' }] },
      dropped: ['第 2 个型号：编号「example-x1」重复'],
    });
  });

  test('keeps a model without packages so its command set can still be looked up', () => {
    const result = sanitizeCatalog(exampleCatalogSource([exampleModelSource({ windows: null, macos: undefined })]));
    expect(result).toMatchObject({
      ok: true,
      catalog: { models: [{ windows: null, macos: null, commandSet: 'tspl' }] },
    });
  });

  test('drops a macOS entry that has neither a pkg nor a download page', () => {
    const result = sanitizeCatalog(exampleCatalogSource([exampleModelSource({ macos: {} })]));
    expect(result).toMatchObject({ ok: true, catalog: { models: [] } });
  });

  test('refuses more models than the limit', () => {
    const models = Array.from({ length: CATALOG_LIMITS.models + 1 }, (_, index) =>
      exampleModelSource({ id: `model-${index}` }),
    );
    expect(sanitizeCatalog(exampleCatalogSource(models))).toMatchObject({ ok: false });
  });
});
