import { createHash } from 'node:crypto';

/**
 * 安装界面插件。DLL 随仓库提供，来源、版本和许可见 resources/installer/plugins/NOTICE.md。
 * 构建时校验哈希：闭源二进制被替换（哪怕是误操作）必须让构建失败，而不是悄悄打进安装包。
 */
export const NSIS_SKIN_PLUGIN = {
  path: 'resources/installer/plugins/x86-unicode/nsNiuniuSkin.dll',
  sha256: 'acf0a9f02f82e3f684cf90cd1fa3f587124cc2d1cf1d01f10017ceefe4892c76',
} as const;

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function verifyPluginDigest(dll: Uint8Array): void {
  const actual = sha256Hex(dll);
  if (actual !== NSIS_SKIN_PLUGIN.sha256) {
    throw new Error(
      `${NSIS_SKIN_PLUGIN.path} 的 SHA-256 是 ${actual}，应为 ${NSIS_SKIN_PLUGIN.sha256}。` +
        '换插件版本时同时更新 NOTICE.md 和 scripts/installer/plugin.ts。',
    );
  }
}
