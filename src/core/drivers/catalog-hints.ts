import type { CatalogModel, DriverCatalog } from './catalog-model';
import type { CatalogModelHint, DriverHints } from './driver-hints';
import { actionFor, type DriverPlatform } from './install-plan';

/** 按驱动名查清单（给 5a、5b）：驱动名不分大小写、忽略首尾和重复的空白。 */
export function catalogDriverHints(catalog: DriverCatalog, platform: DriverPlatform): DriverHints {
  const byName = new Map<string, CatalogModel>();
  for (const model of catalog.models) {
    for (const name of model.driverNames) {
      // 两个型号写了同一个驱动名时用前面那个：出品方的清单里不该这样写，签名脚本照样放行，这里不报错。
      if (!byName.has(normalize(name))) {
        byName.set(normalize(name), model);
      }
    }
  }
  return {
    modelForDriverName: (driverName) => {
      const model = byName.get(normalize(driverName));
      return model ? hintOf(model, platform) : null;
    },
  };
}

function hintOf(model: CatalogModel, platform: DriverPlatform): CatalogModelHint {
  return {
    modelId: model.id,
    brand: model.brand,
    model: model.model,
    commandSet: model.commandSet,
    canInstall: actionFor(model, platform).kind === 'install',
  };
}

function normalize(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}
