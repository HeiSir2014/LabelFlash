/**
 * 从微软的源码编译 ONNX Runtime 的静态库（/MT），合并成一个 onnxruntime.lib，给 Windows 安装包里的扩展静态链接。
 * 为什么自己编、用的版本和选项，见 onnxruntime-build.ts。
 *
 * 结果放在 native/ocr/target/onnxruntime/<版本>-<指纹>/：onnxruntime.lib 和 ONNX Runtime 的许可、第三方声明。
 * 已经有了（同版本、同选项）就直接用。平时不在本机编：从本仓库的预发布版本下载编好的（ONNXRUNTIME_PREBUILT 核对 SHA-256），
 * 那是 .github/workflows/onnxruntime.yml 用同一个脚本编出来的。设置 LABELFLASH_ORT_FROM_SOURCE=1 才在本机编。
 *
 * 需要：Git、CMake、Visual Studio 2022 或 2026 的 C++ 工具、Python 3.10+（只是 ONNX Runtime 的构建脚本要用，不进程序；
 * 不在 PATH 上时用环境变量 ORT_BUILD_PYTHON 指定）。第一次编译要几十分钟，要联网下载依赖。
 * 中间文件默认放 native/ocr/target/onnxruntime-work/（约 5 GB）；路径太深会超出 MSBuild 的长度限制，
 * 可以用环境变量 LABELFLASH_ORT_WORK_DIR 换一个短路径。
 *
 * 用法：
 *   bun scripts/ocr/build-onnxruntime.ts                           下载（或编）并放好，打印目录
 *   bun scripts/ocr/build-onnxruntime.ts --package <目录> --tag <标签>   编好后压缩成发布用的文件（发布工作流用）
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { constants, createGunzip, createGzip } from 'node:zlib';
import packageJson from '../../package.json';
import { msvcTool, visualStudio } from './msvc';
import {
  cmakeGenerator,
  formatSha256Sums,
  githubRepository,
  isSupportedPython,
  libsToMerge,
  ONNXRUNTIME_BUILD_OPTIONS,
  ONNXRUNTIME_PREBUILT,
  ONNXRUNTIME_SOURCE,
  onnxRuntimeBuildKey,
  PREBUILT_ASSETS,
  type PrebuiltOnnxRuntime,
  prebuiltAssetUrl,
  prebuiltReleaseTag,
} from './onnxruntime-build';

export const ONNXRUNTIME_OUTPUT_ROOT = join('native', 'ocr', 'target', 'onnxruntime');
const MERGED_LIB = 'onnxruntime.lib';
/** 构建目录里放静态库的位置（其余是源码和中间文件，不去遍历：依赖的源码里有 Windows 读不了的符号链接）。 */
const LIB_GLOBS = ['Release/*.lib', '*/Release/*.lib', '_deps/*-build/**/Release/*.lib'];

function run(command: string[], cwd?: string): void {
  const result = Bun.spawnSync(command, { cwd, stdout: 'inherit', stderr: 'inherit' });
  if (result.exitCode !== 0) {
    throw new Error(`${command.slice(0, 3).join(' ')} … 失败，退出码 ${result.exitCode}`);
  }
}

function python(): string {
  const candidate = process.env['ORT_BUILD_PYTHON'] ?? 'python';
  const version = Bun.spawnSync([candidate, '--version']);
  const output = `${version.stdout.toString()}${version.stderr.toString()}`.trim();
  if (version.exitCode !== 0 || !isSupportedPython(output)) {
    throw new Error(
      `编译 ONNX Runtime 需要 Python 3.10 以上（${candidate}：${output || '找不到'}）；装好后放进 PATH，或设置 ORT_BUILD_PYTHON`,
    );
  }
  return candidate;
}

/** 浅克隆指定标签，核对提交：标签被移动过就停下，不编来路不明的源码。 */
function checkoutSource(sourceDir: string): void {
  if (!existsSync(sourceDir)) {
    run([
      'git',
      '-c',
      'advice.detachedHead=false',
      'clone',
      '--depth',
      '1',
      '--branch',
      ONNXRUNTIME_SOURCE.tag,
      ONNXRUNTIME_SOURCE.repository,
      sourceDir,
    ]);
  }
  const head = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: sourceDir }).stdout.toString().trim();
  if (head !== ONNXRUNTIME_SOURCE.commit) {
    throw new Error(
      `${sourceDir} 是 ${head}，不是 ONNX Runtime ${ONNXRUNTIME_SOURCE.tag} 的 ${ONNXRUNTIME_SOURCE.commit}`,
    );
  }
}

function mergeLibs(buildDir: string, output: string): void {
  const found = LIB_GLOBS.flatMap((pattern) => [...new Bun.Glob(pattern).scanSync({ cwd: buildDir })]);
  const libs = libsToMerge(found).map((path) => join(buildDir, path));
  if (
    !libs.some((path) => path.endsWith('onnxruntime_session.lib')) ||
    !libs.some((path) => path.endsWith('re2.lib'))
  ) {
    throw new Error(`${buildDir} 里缺少 ONNX Runtime 的静态库`);
  }
  // 同一个符号在几个库里都有（内联函数等）时 lib.exe 报 LNK4006、保留第一个，不影响链接；成员按完整路径保存，不会互相覆盖。
  const merged = Bun.spawnSync([msvcTool('lib.exe'), '/NOLOGO', `/OUT:${output}`, ...libs]);
  if (merged.exitCode !== 0) {
    throw new Error(`合并静态库失败：${merged.stdout.toString()}${merged.stderr.toString()}`);
  }
  console.log(`[ocr] merged ${libs.length} static libraries into ${output}`);
}

/** 在本机从源码编，结果放进 outputDir。 */
function buildFromSource(outputDir: string): void {
  const workDir = resolve(
    process.env['LABELFLASH_ORT_WORK_DIR'] ?? join('native', 'ocr', 'target', 'onnxruntime-work'),
    ONNXRUNTIME_SOURCE.version,
  );
  const sourceDir = join(workDir, 'src');
  const buildRoot = join(workDir, 'build');
  const buildDir = join(buildRoot, 'Release');
  mkdirSync(workDir, { recursive: true });
  checkoutSource(sourceDir);

  const generator = cmakeGenerator(visualStudio().major);
  console.log(`[ocr] building ONNX Runtime ${ONNXRUNTIME_SOURCE.version} (${generator}) in ${buildRoot}`);
  run(
    [
      python(),
      join('tools', 'ci_build', 'build.py'),
      '--build_dir',
      buildRoot,
      '--cmake_generator',
      generator,
      '--update',
      '--build',
      ...ONNXRUNTIME_BUILD_OPTIONS,
    ],
    sourceDir,
  );
  // 静态库构建不链接 onnxruntime.dll，没人依赖 re2，它就不会被编出来；正则类算子要用它。
  run(['cmake', '--build', join(buildDir, '_deps', 're2-build'), '--config', 'Release']);

  // 先写到临时目录再改名：中途失败不会留下一个「看起来编好了」的目录。
  const staging = `${outputDir}.partial`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  mergeLibs(buildDir, join(staging, MERGED_LIB));
  copyFileSync(join(sourceDir, 'LICENSE'), join(staging, 'onnxruntime-LICENSE.txt'));
  copyFileSync(join(sourceDir, 'ThirdPartyNotices.txt'), join(staging, 'onnxruntime-ThirdPartyNotices.txt'));
  renameSync(staging, outputDir);
}

async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

/** 下载一个文件，核对 SHA-256；对不上就删掉并报错，不留下半截或被换过的文件。 */
async function download(url: string, target: string, expectedSha256: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || response.body === null) {
    throw new Error(`下载 ${url} 失败：HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
  const actual = await sha256OfFile(target);
  if (actual !== expectedSha256) {
    rmSync(target, { force: true });
    throw new Error(`${url} 的 SHA-256 是 ${actual}，应当是 ${expectedSha256}`);
  }
}

/** 从本仓库的预发布版本下载编好的静态库，结果放进 outputDir。 */
async function downloadPrebuilt(outputDir: string, prebuilt: PrebuiltOnnxRuntime): Promise<void> {
  const repository = githubRepository(packageJson.repository.url);
  const tag = prebuiltReleaseTag();
  const staging = `${outputDir}.partial`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  for (const asset of Object.values(PREBUILT_ASSETS)) {
    const expected = prebuilt.sha256[asset];
    if (expected === undefined) {
      throw new Error(`ONNXRUNTIME_PREBUILT 里没有 ${asset} 的 SHA-256`);
    }
    const url = prebuiltAssetUrl(repository, tag, asset);
    console.log(`[ocr] downloading ${url}`);
    await download(url, join(staging, asset), expected);
  }
  const compressed = join(staging, PREBUILT_ASSETS.library);
  await pipeline(createReadStream(compressed), createGunzip(), createWriteStream(join(staging, MERGED_LIB)));
  rmSync(compressed);
  renameSync(staging, outputDir);
}

/**
 * 找到或准备好 ONNX Runtime 的静态库，返回放 onnxruntime.lib 的目录。
 * 已经有了就直接用；否则下载预编译的；没有发布过（ONNXRUNTIME_PREBUILT 是 null）或设置了 LABELFLASH_ORT_FROM_SOURCE=1 才在本机编。
 */
export async function onnxRuntimeLibrary(): Promise<string> {
  if (process.platform !== 'win32') {
    throw new Error('只有 Windows 安装包需要自己编的 ONNX Runtime');
  }
  const key = onnxRuntimeBuildKey();
  const outputDir = resolve(ONNXRUNTIME_OUTPUT_ROOT, key);
  if (existsSync(join(outputDir, MERGED_LIB))) {
    console.log(`[ocr] ONNX Runtime ${key} ready: ${outputDir}`);
    return outputDir;
  }
  if (process.env['LABELFLASH_ORT_FROM_SOURCE'] === '1' || ONNXRUNTIME_PREBUILT === null) {
    buildFromSource(outputDir);
  } else if (ONNXRUNTIME_PREBUILT.key !== key) {
    throw new Error(
      `ONNXRUNTIME_PREBUILT 是 ${ONNXRUNTIME_PREBUILT.key} 的，现在的版本和选项是 ${key}：先推送标签 ${prebuiltReleaseTag()} 发布新的预编译包、更新 ONNXRUNTIME_PREBUILT，或设置 LABELFLASH_ORT_FROM_SOURCE=1 在本机编`,
    );
  } else {
    await downloadPrebuilt(outputDir, ONNXRUNTIME_PREBUILT);
  }
  return outputDir;
}

/** 发布工作流用：把编好的库压缩成发布用的文件，写出 SHA256SUMS（填进 ONNXRUNTIME_PREBUILT）。 */
async function packageForRelease(libraryDir: string, destDir: string): Promise<void> {
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  await pipeline(
    createReadStream(join(libraryDir, MERGED_LIB)),
    createGzip({ level: constants.Z_BEST_COMPRESSION }),
    createWriteStream(join(destDir, PREBUILT_ASSETS.library)),
  );
  copyFileSync(join(libraryDir, PREBUILT_ASSETS.license), join(destDir, PREBUILT_ASSETS.license));
  copyFileSync(join(libraryDir, PREBUILT_ASSETS.notices), join(destDir, PREBUILT_ASSETS.notices));
  const sums: Record<string, string> = {};
  for (const asset of Object.values(PREBUILT_ASSETS)) {
    sums[asset] = await sha256OfFile(join(destDir, asset));
  }
  writeFileSync(join(destDir, 'SHA256SUMS'), formatSha256Sums(sums));
  console.log(`[ocr] packaged ${Object.keys(sums).join(', ')} into ${destDir}`);
  console.log(JSON.stringify({ key: onnxRuntimeBuildKey(), sha256: sums }, null, 2));
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { package: { type: 'string' }, tag: { type: 'string' } } });
  if (values.package === undefined) {
    console.log(await onnxRuntimeLibrary());
  } else {
    // 标签由版本和选项决定：推错了标签（例如改了选项却用旧标签）就不发布，免得预编译包和代码对不上。
    if (values.tag !== prebuiltReleaseTag()) {
      throw new Error(`标签 ${values.tag ?? '（没给）'} 和现在的版本、选项不符，应当是 ${prebuiltReleaseTag()}`);
    }
    await packageForRelease(await onnxRuntimeLibrary(), resolve(values.package));
  }
}
