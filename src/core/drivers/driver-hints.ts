/**
 * 给 5a（指令集「自动」）和 5b（诊断里的「重新安装驱动」）用的接口：按系统里的驱动名查在线驱动清单。
 * 这个文件是和 5a、5b 约定好的，改动要同时改它们的调用处（见 docs/superpowers/plans/2026-10-02-driver-install.md）。
 */

/** 清单里写的标签机指令集。 */
export const CATALOG_COMMAND_SETS = ['tspl', 'zpl', 'epl'] as const;
export type CatalogCommandSet = (typeof CATALOG_COMMAND_SETS)[number];

/** 清单里的一个型号。 */
export interface CatalogModelHint {
  modelId: string;
  brand: string;
  model: string;
  /** 清单没写时为 null，由 5a 按驱动名关键字猜。 */
  commandSet: CatalogCommandSet | null;
  /** 清单里有这台电脑的系统能静默安装的安装包（Windows 的 exe / msi、macOS 的 pkg）。 */
  canInstall: boolean;
}

/** 清单没配置、下载不到、过期时什么都查不到（返回 null），调用方按「没有清单」处理。 */
export interface DriverHints {
  /**
   * driverName：Windows 的驱动名（Get-Printer 的 DriverName）、macOS 的 printer-make-and-model；
   * 不分大小写，忽略首尾和重复的空白。
   */
  modelForDriverName(driverName: string): CatalogModelHint | null;
}

export const NO_DRIVER_HINTS: DriverHints = { modelForDriverName: () => null };
