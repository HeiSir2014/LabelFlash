import { describe, expect, test } from 'bun:test';
import { exampleCatalog, exampleModelSource } from '../testing/driver-catalog-fixtures';
import { actionFor, findModelById, findModelByUsbId, installerFileName } from './install-plan';

const catalog = exampleCatalog([
  exampleModelSource(),
  exampleModelSource({
    id: 'example-x2',
    usb: [{ vendorId: '1234', productId: 'ABCE' }],
    windows: null,
    macos: {
      pkg: {
        url: 'https://example.invalid/drivers/x2.pkg',
        sizeBytes: 2_048,
        sha256: 'f'.repeat(64),
        signer: 'Developer ID Installer: 示例品牌 (EXAMPLE123)',
      },
    },
  }),
]);

describe('findModelByUsbId', () => {
  test('finds the model that lists the vendor and product id', () => {
    expect(findModelByUsbId(catalog, { vendorId: 0x1234, productId: 0xabce })?.id).toBe('example-x2');
    expect(findModelByUsbId(catalog, { vendorId: 0x1234, productId: 0x0001 })).toBeNull();
    expect(findModelById(catalog, 'example-x1')?.model).toBe('示例型号 X1');
  });
});

describe('actionFor', () => {
  const [x1, x2] = catalog.models;
  if (!x1 || !x2) {
    throw new Error('example catalog is missing a model');
  }

  test('installs the Windows package on Windows', () => {
    expect(actionFor(x1 ?? null, 'windows')).toMatchObject({ kind: 'install', target: { platform: 'windows' } });
  });

  test('opens the download page on macOS when there is no pkg', () => {
    expect(actionFor(x1 ?? null, 'mac')).toEqual({
      kind: 'open-page',
      model: x1,
      url: 'https://example.invalid/drivers/x1-mac',
    });
  });

  test('installs the pkg on macOS and has nothing to install on Windows for a mac-only model', () => {
    expect(actionFor(x2 ?? null, 'mac')).toMatchObject({ kind: 'install', target: { platform: 'mac' } });
    expect(actionFor(x2 ?? null, 'windows')).toEqual({ kind: 'no-package', model: x2 });
  });

  test('says the model is not in the catalog', () => {
    expect(actionFor(null, 'windows')).toEqual({ kind: 'not-in-catalog' });
  });

  test('names the installer after its kind so Windows runs it the right way', () => {
    const action = actionFor(x1 ?? null, 'windows');
    expect(action.kind === 'install' ? installerFileName(action.target) : '').toBe('driver-installer.exe');
  });
});
