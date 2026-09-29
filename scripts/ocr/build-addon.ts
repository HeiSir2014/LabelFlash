/**
 * 编译 OCR 的 Node-API 扩展，放到 native/ocr/node/bin/ocr-addon.<平台>-<架构>.node（Bun 和 Node.js 共用这一个文件）。
 * 用法：bun run ocr:build
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { addonFileName } from '../../native/ocr/node/src/addon-name.ts';

const WORKSPACE = 'native/ocr';
const OUTPUT_DIR = join(WORKSPACE, 'node', 'bin');

/** cargo 产出的动态库文件名（cdylib 的命名随平台不同）。 */
function cargoArtifact(platform: NodeJS.Platform): string {
  switch (platform) {
    case 'win32':
      return 'ocr_addon.dll';
    case 'darwin':
      return 'libocr_addon.dylib';
    default:
      return 'libocr_addon.so';
  }
}

/** 编译并放好扩展，返回它的路径。 */
export function buildAddon(): string {
  const result = Bun.spawnSync(
    ['cargo', 'build', '--release', '--manifest-path', join(WORKSPACE, 'Cargo.toml'), '-p', 'ocr-addon'],
    { stdout: 'inherit', stderr: 'inherit' },
  );
  if (result.exitCode !== 0) {
    throw new Error(`cargo build 失败，退出码 ${result.exitCode}（需要 Rust 工具链：https://rustup.rs）`);
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const target = join(OUTPUT_DIR, addonFileName(process.platform, process.arch));
  copyFileSync(join(WORKSPACE, 'target', 'release', cargoArtifact(process.platform)), target);
  console.log(`[ocr] ${target}`);
  return target;
}

if (import.meta.main) {
  buildAddon();
}
