import { expect, test } from 'bun:test';
import { exampleWindowsTarget } from '../../core/testing/driver-catalog-fixtures';
import { FakePrinters } from '../printing/fake-printers';
import { FakeDrivers, parseFakeDrivers, testCatalogKey } from './fake-drivers';

const DEVICE = {
  instanceId: 'USB\\VID_1234&PID_ABCD\\E2E0001',
  name: '未知设备',
  pnpClass: '',
  problemCode: 28,
  compatibleIds: ['USB\\Class_07'],
  parentId: '',
};
const SPEC = {
  devices: [DEVICE],
  files: { 'https://example.invalid/drivers/x1-setup.exe': Buffer.from('MZ').toString('base64') },
  authenticode: { status: 'Valid', subject: 'CN=示例品牌有限公司' },
  installExitCode: 0,
  printerAfterInstall: { name: '示例标签机', paper: null, readiness: null },
};

test('is only read by unpackaged builds', () => {
  const env = { CDL_LABELFLASH_FAKE_DRIVERS: JSON.stringify(SPEC), CDL_LABELFLASH_DRIVER_CATALOG_TEST_KEY: 'AAAA' };
  expect(parseFakeDrivers(env, true)).toBeNull();
  expect(testCatalogKey(env, true)).toEqual({});
  expect(parseFakeDrivers(env, false)).toEqual(SPEC);
  expect(testCatalogKey(env, false)).toEqual({ e2e: 'AAAA' });
});

test('serves fake installers, then removes the device and adds the printer after a successful install', async () => {
  const printers = new FakePrinters([]);
  const drivers = new FakeDrivers(SPEC, printers);
  const response = await drivers.fetch()('https://example.invalid/drivers/x1-setup.exe', {});
  expect(await response.text()).toBe('MZ');
  expect((await drivers.fetch()('https://example.invalid/other.exe', {})).status).toBe(404);
  expect(await drivers.deviceSource().detect(null)).toHaveLength(1);
  const file = { path: 'C:\\temp\\driver-installer.exe', sizeBytes: 2, sha256: '' };
  expect(await drivers.installer().install(file, exampleWindowsTarget())).toEqual({
    kind: 'installed',
    needsRestart: false,
  });
  expect(drivers.installs).toEqual([file.path]);
  expect(await drivers.deviceSource().detect(null)).toEqual([]);
  expect((await printers.listPrinters()).map((printer) => printer.name)).toEqual(['示例标签机']);
});
