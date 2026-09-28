/**
 * 构建时注入的默认值（electron.vite.config.ts 的 define）。
 * 用 bun test 直接运行源码时没有注入，这个标识符不存在，按「没有默认值」处理。
 */
import { sanitizeRelayUrl } from '../../shared/relay-url';

declare const CDL_LABELFLASH_DEFAULT_RELAY_URL: string | undefined;

/** 安装包自带的中转地址：官方安装包是官方中转服务；自己构建时没设环境变量就是 null。 */
export const BUILD_DEFAULT_RELAY_URL: string | null = sanitizeRelayUrl(
  typeof CDL_LABELFLASH_DEFAULT_RELAY_URL === 'string' ? CDL_LABELFLASH_DEFAULT_RELAY_URL : null,
);
