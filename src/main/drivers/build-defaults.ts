/**
 * 构建时注入的默认驱动清单地址（electron.vite.config.ts 的 define）：官方安装包由 CI 从 Actions 变量
 * LABELFLASH_DEFAULT_DRIVER_CATALOG_URL 传入，代码里不写域名。用 bun test 直接运行源码时没有注入，按「没有默认值」处理。
 */
import { sanitizeCatalogUrl } from '../../shared/driver-catalog-url';

declare const CDL_LABELFLASH_DEFAULT_DRIVER_CATALOG_URL: string | undefined;

/** 安装包自带的清单地址；自己构建、没设环境变量时为 null（界面显示「未配置驱动清单地址」）。 */
export const BUILD_DEFAULT_DRIVER_CATALOG_URL: string | null = sanitizeCatalogUrl(
  typeof CDL_LABELFLASH_DEFAULT_DRIVER_CATALOG_URL === 'string' ? CDL_LABELFLASH_DEFAULT_DRIVER_CATALOG_URL : null,
);
