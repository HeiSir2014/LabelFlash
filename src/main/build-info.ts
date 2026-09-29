/**
 * 构建号：CI 每跑一次自增的编号（GitHub Actions 的 run_number），打包时由环境变量 BUILD_NUMBER 传入。
 * electron-builder 读同一个变量，写进 Windows 的文件版本（1.0.2.123）和 macOS 的 CFBundleVersion；
 * 这里经 electron.vite.config.ts 的 define 注入，给「关于」和日志用。
 *
 * 构建号不进 package.json 的 version：标签检查、自动更新的版本比较、按文件名找旧版 blockmap 都依赖纯粹的 x.y.z。
 * 本机构建和 bun test 直接运行源码时没有注入，按「没有构建号」处理。
 */

declare const CDL_LABELFLASH_BUILD_NUMBER: string | undefined;

/** Windows 文件版本每一段的上限。 */
const MAX_VERSION_FIELD = 65_535;

export function parseBuildNumber(raw: string | null): string | null {
  if (raw === null || !/^\d+$/.test(raw)) {
    return null;
  }
  return Number(raw) <= MAX_VERSION_FIELD ? raw : null;
}

export const BUILD_NUMBER: string | null = parseBuildNumber(
  typeof CDL_LABELFLASH_BUILD_NUMBER === 'string' ? CDL_LABELFLASH_BUILD_NUMBER : null,
);
