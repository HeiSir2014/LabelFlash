import type { ElectronApplication, Page } from '@playwright/test';
import { callApi, openConfig } from './support/app-helpers';
import {
  catalogModel,
  catalogText,
  e2eCatalogKeys,
  fakeDrivers,
  INSTALLER_BYTES,
  INSTALLER_URL,
  NEW_PRINTER,
  serveCatalog,
} from './support/driver-catalog';
import { expect, test } from './support/fixtures';

const keys = e2eCatalogKeys();

function driverCard(page: Page) {
  return page.getByRole('region', { name: '驱动' });
}

function fakeInstalls(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as { e2eFakeDrivers?: { installs: string[] } }).e2eFakeDrivers?.installs ?? []);
}

test('says the catalog address is not configured and still lists the printer devices', async ({ electronApp }) => {
  const { page } = await electronApp.launch({
    fakePrinters: [],
    fakeDrivers: fakeDrivers(),
    driverCatalogKey: keys.publicKey,
  });
  await openConfig(page, '打印机');
  const card = driverCard(page);
  await expect(card).toContainText('未配置驱动清单地址');
  await expect(card).toContainText('USB 1234:ABCD · 没装驱动');
  await expect(card).toContainText('驱动清单不可用，不能自动安装');
  await expect(card.getByRole('button', { name: /安装驱动/ })).toHaveCount(0);
});

test('says this build has no embedded keys, never asks for an address, and still lists printer devices', async ({
  electronApp,
}) => {
  // 不传 driverCatalogKey：DRIVER_CATALOG_PUBLIC_KEYS 是空表，程序没有任何可信公钥。
  const { page } = await electronApp.launch({ fakePrinters: [], fakeDrivers: fakeDrivers() });
  await openConfig(page, '打印机');
  const card = driverCard(page);
  await expect(card).toContainText('这个版本没有内置驱动清单公钥，不能自动安装驱动');
  await expect(card).not.toContainText('未配置驱动清单地址');
  await expect(card).not.toContainText('请更新程序');
  await expect(card).toContainText('USB 1234:ABCD · 没装驱动');
  await expect(card.getByRole('button', { name: /安装驱动/ })).toHaveCount(0);
});

test('installs the driver from the signed catalog and shows the new printer', async ({ electronApp }) => {
  const server = await serveCatalog(catalogText(keys, [catalogModel()]));
  try {
    const { app, page } = await electronApp.launch({
      fakePrinters: [],
      fakeDrivers: fakeDrivers(),
      driverCatalogKey: keys.publicKey,
    });
    await callApi(page, 'updateSettings', { driverCatalogUrl: server.url });
    await openConfig(page, '打印机');
    const card = driverCard(page);
    await expect(card).toContainText('1 个型号');
    await expect(card).toContainText('清单里没有这个型号');
    await card.getByRole('button', { name: /安装驱动/ }).click();
    await expect(card.getByRole('status')).toContainText('驱动已装好，新打印机：示例标签机');
    await expect(page.locator('.printer-row__name', { hasText: '示例标签机' })).toBeVisible();
    await expect(card).not.toContainText('1234:ABCD');
    expect(await fakeInstalls(app)).toHaveLength(1);
  } finally {
    await server.close();
  }
});

test('refuses a catalog whose signature does not match', async ({ electronApp }) => {
  const envelope = JSON.parse(catalogText(keys, [catalogModel()])) as Record<string, string>;
  const forged = JSON.stringify([catalogModel({ id: 'forged' })]);
  envelope['payload'] = Buffer.from(forged).toString('base64');
  const server = await serveCatalog(JSON.stringify(envelope));
  try {
    const { page } = await electronApp.launch({
      fakePrinters: [],
      fakeDrivers: fakeDrivers(),
      driverCatalogKey: keys.publicKey,
    });
    await callApi(page, 'updateSettings', { driverCatalogUrl: server.url });
    await openConfig(page, '打印机');
    await expect(driverCard(page)).toContainText('驱动清单的签名不对');
    await expect(driverCard(page).getByRole('button', { name: /安装驱动/ })).toHaveCount(0);
  } finally {
    await server.close();
  }
});

test('never runs a download whose SHA-256 differs from the catalog', async ({ electronApp }) => {
  const server = await serveCatalog(catalogText(keys, [catalogModel()]));
  const swapped = Buffer.alloc(INSTALLER_BYTES.length, 0x41).toString('base64');
  try {
    const { app, page } = await electronApp.launch({
      fakePrinters: [],
      fakeDrivers: fakeDrivers({ files: { [INSTALLER_URL]: swapped } }),
      driverCatalogKey: keys.publicKey,
    });
    await callApi(page, 'updateSettings', { driverCatalogUrl: server.url });
    await openConfig(page, '打印机');
    await driverCard(page)
      .getByRole('button', { name: /安装驱动/ })
      .click();
    await expect(driverCard(page).getByRole('alert')).toContainText('SHA-256 不一致');
    expect(await fakeInstalls(app)).toEqual([]);
    // 没装上：那台设备还在列表里。
    await expect(driverCard(page)).toContainText('USB 1234:ABCD · 没装驱动');
  } finally {
    await server.close();
  }
});

test('reinstalls the driver of an installed printer by its driver name', async ({ electronApp }) => {
  const server = await serveCatalog(catalogText(keys, [catalogModel()]));
  try {
    const { app, page } = await electronApp.launch({
      fakePrinters: [{ ...NEW_PRINTER, driverName: '示例品牌 X1' }],
      fakeDrivers: fakeDrivers({ devices: [], printerAfterInstall: null }),
      driverCatalogKey: keys.publicKey,
    });
    await callApi(page, 'updateSettings', { driverCatalogUrl: server.url });
    await openConfig(page, '打印机');
    await callApi(page, 'reinstallPrinterDriver', NEW_PRINTER.name);
    // 重装的是一台已经有打印机队列的设备，不是新插的 USB 设备：不找「新」打印机，也不提示插拔 USB 线。
    await expect(driverCard(page).getByRole('status')).toContainText('驱动已重新安装');
    expect(await fakeInstalls(app)).toHaveLength(1);
  } finally {
    await server.close();
  }
});
