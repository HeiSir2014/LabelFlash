import type { CatalogModel, DriverCatalog, MacPkg, WindowsPackage } from './catalog-model';
import { isSameUsbId, type UsbId } from './usb-id';

/** 能自动装驱动的平台；其他平台不显示安装。 */
export type DriverPlatform = 'windows' | 'mac';

/** 要装的东西：哪个型号、哪个安装包。 */
export type InstallTarget =
  | { platform: 'windows'; model: CatalogModel; package: WindowsPackage }
  | { platform: 'mac'; model: CatalogModel; package: MacPkg };

/** 这台设备在这个平台上能做什么。 */
export type DeviceAction =
  | { kind: 'install'; target: InstallTarget }
  | { kind: 'open-page'; model: CatalogModel; url: string }
  | { kind: 'no-package'; model: CatalogModel }
  | { kind: 'not-in-catalog' };

export function findModelByUsbId(catalog: DriverCatalog, id: UsbId): CatalogModel | null {
  return catalog.models.find((model) => model.usb.some((item) => isSameUsbId(item, id))) ?? null;
}

export function findModelById(catalog: DriverCatalog, modelId: string): CatalogModel | null {
  return catalog.models.find((model) => model.id === modelId) ?? null;
}

/** Windows：清单里有安装包就装；macOS：有 pkg 就装，没有就打开官方下载页；都没有说明这个平台没有驱动。 */
export function actionFor(model: CatalogModel | null, platform: DriverPlatform): DeviceAction {
  if (model === null) {
    return { kind: 'not-in-catalog' };
  }
  if (platform === 'windows') {
    return model.windows
      ? { kind: 'install', target: { platform, model, package: model.windows } }
      : { kind: 'no-package', model };
  }
  if (model.macos?.pkg) {
    return { kind: 'install', target: { platform, model, package: model.macos.pkg } };
  }
  if (model.macos?.downloadPage) {
    return { kind: 'open-page', model, url: model.macos.downloadPage };
  }
  return { kind: 'no-package', model };
}

/** 临时文件名：Windows 按扩展名决定怎么运行（msi 交给 msiexec），macOS 的 installer 要 .pkg。 */
export function installerFileName(target: InstallTarget): string {
  return target.platform === 'windows' ? `driver-installer.${target.package.kind}` : 'driver-installer.pkg';
}
