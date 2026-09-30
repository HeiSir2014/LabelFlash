/**
 * 编译 OCR 的 Node-API 扩展。
 * - 开发用（bun run ocr:build）：链接 ort 下载的 ONNX Runtime 预编译包，放到 native/ocr/node/bin/ocr-addon.<平台>-<架构>.node
 *   （Bun 和 Node.js 共用这一个文件）。
 * - Windows 安装包用（stage-resources.ts）：链接自己编的 /MT ONNX Runtime（build-onnxruntime.ts），扩展也用静态 C 运行库，
 *   不依赖 VC++ 运行库。编到单独的 target 目录，不和开发用的互相覆盖、互相触发重编。
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { addonFileName } from '../../native/ocr/node/src/addon-name.ts';

const WORKSPACE = 'native/ocr';
const OUTPUT_DIR = join(WORKSPACE, 'node', 'bin');
const STATIC_RUNTIME_TARGET_DIR = join(WORKSPACE, 'target', 'static-crt');

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

function cargoBuild(env: Record<string, string>): void {
  const result = Bun.spawnSync(
    ['cargo', 'build', '--release', '--manifest-path', join(WORKSPACE, 'Cargo.toml'), '-p', 'ocr-addon'],
    { stdout: 'inherit', stderr: 'inherit', env: { ...process.env, ...env } },
  );
  if (result.exitCode !== 0) {
    throw new Error(`cargo build 失败，退出码 ${result.exitCode}（需要 Rust 工具链：https://rustup.rs）`);
  }
}

/** 开发用：编译并放好扩展，返回它的路径。 */
export function buildAddon(): string {
  cargoBuild({});
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const target = join(OUTPUT_DIR, addonFileName(process.platform, process.arch));
  copyFileSync(join(WORKSPACE, 'target', 'release', cargoArtifact(process.platform)), target);
  console.log(`[ocr] ${target}`);
  return target;
}

/** Windows 安装包用：链接 onnxRuntimeDir 里自己编的 onnxruntime.lib，返回 cargo 产出的扩展路径。 */
export function buildStaticRuntimeAddon(onnxRuntimeDir: string): string {
  cargoBuild({
    // ort-sys 在这个目录里找到单个 onnxruntime.lib 就只链接它，不再下载预编译包。
    ORT_LIB_LOCATION: onnxRuntimeDir,
    // 和 /MT 编的 ONNX Runtime 保持一致；混用会链接失败（LIBCMT 和 MSVCRT 冲突）。
    RUSTFLAGS: '-C target-feature=+crt-static',
    CARGO_TARGET_DIR: STATIC_RUNTIME_TARGET_DIR,
  });
  const artifact = join(STATIC_RUNTIME_TARGET_DIR, 'release', cargoArtifact(process.platform));
  console.log(`[ocr] ${artifact}`);
  return artifact;
}

if (import.meta.main) {
  buildAddon();
}
