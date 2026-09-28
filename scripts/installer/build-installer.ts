import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildSkins, SKIN_OUTPUT_DIR } from './build-skin';
import { NSIS_SKIN_PLUGIN, verifyPluginDigest } from './plugin';

/**
 * 构建自绘安装包（在 electron-vite build 和 verify:bundle 之后运行）。
 *
 * electron-builder 遇到自定义 NSIS 脚本时不会生成卸载程序，所以分两段：
 *   1. 用 electron-builder 自带脚本打一次（不压缩，只为取卸载程序），签名钩子把生成的卸载程序复制出来；
 *   2. 复用第一段打好的程序目录，用 resources/installer/installer.nsi 打出真正发布的安装包。
 *
 * 用法：bun scripts/installer/build-installer.ts --publish never|always
 */

const STOCK_OUTPUT_DIR = `${SKIN_OUTPUT_DIR}/stock`;
const UNINSTALLER_PATH = `${SKIN_OUTPUT_DIR}/uninstaller.exe`;
const CUSTOM_SCRIPT = 'resources/installer/installer.nsi';
const CAPTURE_HOOK = 'scripts/installer/capture-uninstaller.cjs';
const PUBLISH_MODES = ['never', 'always'] as const;
type PublishMode = (typeof PUBLISH_MODES)[number];

export function parsePublishMode(argv: readonly string[]): PublishMode {
  const index = argv.indexOf('--publish');
  const value = index === -1 ? undefined : argv[index + 1];
  const mode = PUBLISH_MODES.find((candidate) => candidate === value);
  if (!mode) {
    throw new Error(`用法：build-installer.ts --publish ${PUBLISH_MODES.join('|')}（收到 ${value ?? '空'}）`);
  }
  return mode;
}

function runElectronBuilder(args: readonly string[], env: Record<string, string> = {}): void {
  const result = Bun.spawnSync([process.execPath, 'x', 'electron-builder', '--win', '--x64', ...args], {
    stdio: ['inherit', 'inherit', 'inherit'],
    env: { ...process.env, ...env },
  });
  if (result.exitCode !== 0) {
    throw new Error(`electron-builder ${args.join(' ')} 失败，退出码 ${result.exitCode}`);
  }
}

async function main(): Promise<void> {
  const publish = parsePublishMode(Bun.argv.slice(2));
  verifyPluginDigest(readFileSync(NSIS_SKIN_PLUGIN.path));
  await buildSkins();

  const startedAt = Date.now();
  runElectronBuilder(
    [
      '--publish',
      'never',
      `-c.directories.output=${STOCK_OUTPUT_DIR}`,
      // 这一段的安装包不发布，不压缩省时间；卸载程序不受影响。
      '-c.compression=store',
      `-c.win.signtoolOptions.sign=${CAPTURE_HOOK}`,
    ],
    { LABELFLASH_UNINSTALLER_OUT: resolve(UNINSTALLER_PATH) },
  );
  // 必须是这一次生成的：上一次构建留下的卸载程序可能来自旧配置。
  if (!existsSync(UNINSTALLER_PATH) || statSync(UNINSTALLER_PATH).mtimeMs < startedAt) {
    throw new Error(`第一段没有取得卸载程序（${UNINSTALLER_PATH}），检查签名钩子 ${CAPTURE_HOOK}`);
  }

  runElectronBuilder([
    '--publish',
    publish,
    '--prepackaged',
    join(STOCK_OUTPUT_DIR, 'win-unpacked'),
    `-c.nsis.script=${CUSTOM_SCRIPT}`,
  ]);
}

if (import.meta.main) {
  await main();
}
