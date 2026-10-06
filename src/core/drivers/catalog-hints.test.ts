import { expect, test } from 'bun:test';
import { exampleCatalog, exampleModelSource } from '../testing/driver-catalog-fixtures';
import { catalogDriverHints } from './catalog-hints';
import { NO_DRIVER_HINTS } from './driver-hints';

const catalog = exampleCatalog([exampleModelSource({ driverNames: ['示例品牌 X1', 'Example X1 Driver'] })]);

test('finds a model by the driver name the system reports, ignoring case and extra spaces', () => {
  expect(catalogDriverHints(catalog, 'windows').modelForDriverName('  example x1   driver')).toEqual({
    modelId: 'example-x1',
    brand: '示例品牌',
    model: '示例型号 X1',
    commandSet: 'tspl',
    canInstall: true,
  });
});

test('says whether this platform can install it', () => {
  expect(catalogDriverHints(catalog, 'mac').modelForDriverName('Example X1 Driver')?.canInstall).toBe(false);
});

test('finds nothing for unknown drivers or without a catalog', () => {
  expect(catalogDriverHints(catalog, 'windows').modelForDriverName('Generic / Text Only')).toBeNull();
  expect(NO_DRIVER_HINTS.modelForDriverName('Example X1 Driver')).toBeNull();
});
