/**
 * 从微软的源码编译 ONNX Runtime 的静态库（/MT），合并成一个 onnxruntime.lib，给 Windows 安装包里的扩展静态链接。
 * 为什么自己编、用的版本和选项，见 onnxruntime-build.ts。
 *
 * 结果放在 native/ocr/target/onnxruntime/<版本>-<指纹>/：onnxruntime.lib 和 ONNX Runtime 的许可、第三方声明。
 * 已经编过（同版本、同选项）就直接用；CI 按这个目录缓存。
 *
 * 需要：Git、CMake、Visual Studio 2022 或 2026 的 C++ 工具、Python 3.10+（只是 ONNX Runtime 的构建脚本要用，不进程序；
 * 不在 PATH 上时用环境变量 ORT_BUILD_PYTHON 指定）。第一次编译要几十分钟，要联网下载依赖。
 * 中间文件默认放 native/ocr/target/onnxruntime-work/（约 5 GB）；路径太深会超出 MSBuild 的长度限制，
 * 可以用环境变量 LABELFLASH_ORT_WORK_DIR 换一个短路径。
 *
 * 用法：bun scripts/ocr/build-onnxruntime.ts
 */
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { msvcTool, visualStudio } from './msvc';
import {
  cmakeGenerator,
  isSupportedPython,
  libsToMerge,
  ONNXRUNTIME_BUILD_OPTIONS,
  ONNXRUNTIME_SOURCE,
  onnxRuntimeBuildKey,
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

/** 编好（或找到已经编好的）ONNX Runtime，返回放 onnxruntime.lib 的目录。 */
export function buildOnnxRuntime(): string {
  if (process.platform !== 'win32') {
    throw new Error('只有 Windows 安装包需要自己编的 ONNX Runtime');
  }
  const key = onnxRuntimeBuildKey();
  const outputDir = resolve(ONNXRUNTIME_OUTPUT_ROOT, key);
  if (existsSync(join(outputDir, MERGED_LIB))) {
    console.log(`[ocr] ONNX Runtime ${key} already built: ${outputDir}`);
    return outputDir;
  }
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
  return outputDir;
}

if (import.meta.main) {
  console.log(buildOnnxRuntime());
}
