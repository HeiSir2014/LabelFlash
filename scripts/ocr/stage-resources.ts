/**
 * 把 Windows 安装包要带的本地 OCR 文件放到 dist/.ocr/（electron-builder.yml 的 win.extraResources 把它装进 resources/ocr/）：
 * - ocr-addon.node：编译好的 Node-API 扩展（ONNX Runtime 静态链接在里面）；
 * - det.onnx、rec.onnx、dict.txt：PP-OCRv6 small 检测 + small 识别（tiny 识别会把 A 读成 4，见 OCR 引擎设计第 10 节）；
 * - VC++ 运行库：扩展依赖它，不是每台 Windows 都装了。放在扩展旁边：Node 按扩展所在目录找依赖
 *   （libuv 用 LOAD_WITH_ALTERED_SEARCH_PATH 加载），不装进系统目录。取自构建机 Visual Studio 的可再发行目录。
 * 由 scripts/installer/build-installer.ts 在打安装包前调用；也可以单独运行：bun scripts/ocr/stage-resources.ts
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGED_ADDON_NAME } from '../../src/main/ocr/ocr-files';
import { buildAddon } from './build-addon';
import { fetchModels, MODELS_DIR } from './fetch-models';

export const OCR_STAGING_DIR = join('dist', '.ocr');
/** 安装包带的模型档位。 */
const PACKAGED_MODEL_TIER = 'small';
/** 扩展依赖的 VC++ 运行库（dumpbin /dependents 看到的四个）。 */
export const VC_RUNTIME_DLLS = ['msvcp140.dll', 'msvcp140_1.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'] as const;
const VSWHERE = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';

/** Visual Studio 可再发行目录里 x64 的 CRT：VC\Redist\MSVC\<版本>\x64\Microsoft.VC14x.CRT，取最新的版本。 */
function vcRuntimeDir(): string {
  const found = Bun.spawnSync([VSWHERE, '-latest', '-products', '*', '-property', 'installationPath']);
  const installation = found.stdout.toString().trim();
  if (found.exitCode !== 0 || installation === '') {
    throw new Error('找不到 Visual Studio（需要「使用 C++ 的桌面开发」）：取不到 VC++ 运行库');
  }
  const redist = join(installation, 'VC', 'Redist', 'MSVC');
  const versions = readdirSync(redist)
    .filter((name) => /^\d+\.\d+\.\d+$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const version of versions.reverse()) {
    const x64 = join(redist, version, 'x64');
    const crt = existsSync(x64) ? readdirSync(x64).find((name) => /^Microsoft\.VC\d+\.CRT$/.test(name)) : undefined;
    if (crt) {
      return join(x64, crt);
    }
  }
  throw new Error(`${redist} 里没有 x64 的 VC++ 运行库`);
}

export async function stageOcrResources(): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('只有 Windows 安装包带本地 OCR');
  }
  await fetchModels();
  const addon = buildAddon();
  rmSync(OCR_STAGING_DIR, { recursive: true, force: true });
  mkdirSync(OCR_STAGING_DIR, { recursive: true });
  copyFileSync(addon, join(OCR_STAGING_DIR, PACKAGED_ADDON_NAME));
  for (const file of ['det.onnx', 'rec.onnx', 'dict.txt']) {
    copyFileSync(join(MODELS_DIR, PACKAGED_MODEL_TIER, file), join(OCR_STAGING_DIR, file));
  }
  const runtime = vcRuntimeDir();
  for (const dll of VC_RUNTIME_DLLS) {
    copyFileSync(join(runtime, dll), join(OCR_STAGING_DIR, dll));
  }
  console.log(`[ocr] staged ${readdirSync(OCR_STAGING_DIR).join(', ')} (VC++ runtime from ${runtime})`);
}

if (import.meta.main) {
  await stageOcrResources();
}
