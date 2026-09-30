/**
 * 自己编译的 ONNX Runtime（Windows 安装包用）：源码版本、编译选项，和 build-onnxruntime.ts 用到的几个纯函数。
 *
 * 为什么自己编：ort 下载的预编译包在 Windows 上只有 /MD 版本（引用 MSVCRT / msvcprt），
 * 链接进扩展后，扩展依赖 VC++ 运行库（msvcp140、vcruntime140），还导入 DirectML.dll（Windows 10 2004 之前没有）。
 * 用 /MT（静态 C 运行库）编 ONNX Runtime 的静态库、扩展也用 crt-static 编，
 * 得到的 .node 只依赖每台 Windows 都有的系统 DLL。
 *
 * 不加 /arch:AVX2：ort 的预编译包从 2025 年 10 月起按 Haswell 编（/arch:AVX2），没有 AVX2 的 CPU（低端赛扬、奔腾）上一加载就崩。
 * 按 x64 基线编，矩阵运算（MLAS）照样在运行时挑 AVX2 / AVX-512 的实现；代价是二维码附近一块慢约 50 毫秒（0.20 秒对 0.15 秒）。
 * 不开链接时优化（--enable_lto）：实测没有变快，静态库还会超过 4 GB，合并不成一个 onnxruntime.lib。
 */
import { createHash } from 'node:crypto';

/** 微软官方源码。换版本时同时改 tag 和 commit：tag 可能被移动，按 commit 核对。 */
export const ONNXRUNTIME_SOURCE = {
  repository: 'https://github.com/microsoft/onnxruntime',
  version: '1.30.0',
  tag: 'v1.30.0',
  commit: 'f2c39fe2f838cf35ce7da92824f5a5e3ee6e88a7',
} as const;

/** 传给 ONNX Runtime 的 tools/ci_build/build.py 的选项（构建目录和 CMake 生成器另外按机器给）。 */
export const ONNXRUNTIME_BUILD_OPTIONS = [
  '--config',
  'Release',
  '--parallel',
  '--skip_tests',
  // /MT：C/C++ 运行库静态链接，扩展不再依赖 VC++ 运行库。
  '--enable_msvc_static_runtime',
  // 关掉遥测开关（1.30 起默认开）。开源源码编出来的本来就不进微软的遥测通道：公开的 TraceLoggingConfig.h
  // 把 ETW 提供者组置空，只有微软内部构建带上报配置；这里再明确关掉，识别只在本机，不向外发任何东西。
  '--no_telemetry',
  // 传统机器学习算子（ai.onnx.ml），PP-OCR 模型用不到。
  '--disable_ml_ops',
  // 新版编译器的新警告不应让构建失败（ONNX Runtime 默认把警告当错误）。
  '--compile_no_warning_as_error',
  '--cmake_extra_defines',
  'onnxruntime_BUILD_UNIT_TESTS=OFF',
] as const;

/** 构建脚本要求的最低 Python 版本（build_args.py 用了 match 语句）。 */
export const MIN_PYTHON = { major: 3, minor: 10 } as const;

/** 版本和选项的指纹：编出来的库按它存放，换了任何一项就重新编（ort-sys 也因路径变了而重新链接）。 */
export function onnxRuntimeBuildKey(): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ source: ONNXRUNTIME_SOURCE, options: ONNXRUNTIME_BUILD_OPTIONS }))
    .digest('hex');
  return `${ONNXRUNTIME_SOURCE.version}-${digest.slice(0, 12)}`;
}

/** 按 Visual Studio 的主版本号选 CMake 生成器（build.py 默认写死 2022，只装了 2026 的机器上会失败）。 */
export function cmakeGenerator(visualStudioMajor: number): string {
  switch (visualStudioMajor) {
    case 17:
      return 'Visual Studio 17 2022';
    case 18:
      return 'Visual Studio 18 2026';
    default:
      throw new Error(
        `不支持的 Visual Studio 版本 ${visualStudioMajor}：ONNX Runtime 的构建脚本只认 2022（17）和 2026（18）`,
      );
  }
}

/** 解析 `python --version` 的输出，版本够不够用。 */
export function isSupportedPython(versionOutput: string): boolean {
  const match = /Python (\d+)\.(\d+)/.exec(versionOutput);
  if (!match) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > MIN_PYTHON.major || (major === MIN_PYTHON.major && minor >= MIN_PYTHON.minor);
}

/**
 * 从构建目录里的 .lib（相对路径）挑出要合并进 onnxruntime.lib 的：只要 Release 目录下的；
 * 不要完整版 protobuf 和 protoc：它们只用来生成代码，ONNX Runtime 链接的是 protobuf-lite，一起合并会有一堆重复符号。
 */
export function libsToMerge(relativePaths: readonly string[]): string[] {
  const excluded = new Set(['libprotobuf.lib', 'libprotoc.lib']);
  return relativePaths
    .map((path) => path.replaceAll('\\', '/'))
    .filter((path) => {
      const parts = path.split('/');
      const name = parts.at(-1) ?? '';
      return (
        name.endsWith('.lib') && parts.at(-2) === 'Release' && !parts.includes('CMakeFiles') && !excluded.has(name)
      );
    })
    .sort();
}

/**
 * 从 `dumpbin /dependents` 的输出里找出不该有的依赖：VC++ 运行库、通用 C 运行库的转发 DLL、DirectML 和 D3D12。
 * 有它们说明某一部分还是 /MD 编的，或者链接到了预编译包。
 */
export function unwantedImports(dependentsOutput: string): string[] {
  const unwanted = /^(msvcp\d|vcruntime\d|concrt\d|api-ms-win-crt-|directml\.dll|d3d12\.dll)/i;
  return dependentsOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\.dll$/i.test(line) && unwanted.test(line));
}

/**
 * 预编译好的静态库：由 .github/workflows/onnxruntime.yml 在本仓库的一个预发布版本（prerelease，不是程序的发布，
 * 不标成 latest，自动更新看不到它）里发布。打安装包时下载、按下面的 SHA-256 核对，不用每次花半小时编。
 * 只有静态库贵：扩展是我们自己的 Rust 代码，随源码每次编（约 1 分钟），不做成预编译包。
 */
export const PREBUILT_ASSETS = {
  library: 'onnxruntime-win-x64-static.lib.gz',
  license: 'onnxruntime-LICENSE.txt',
  notices: 'onnxruntime-ThirdPartyNotices.txt',
} as const;

export interface PrebuiltOnnxRuntime {
  /** 发布时的 onnxRuntimeBuildKey()：和当前的不一样，说明改了版本或选项，要重新发布。 */
  key: string;
  /** 每个文件的 SHA-256（发布工作流打印出来的 SHA256SUMS）。 */
  sha256: Record<string, string>;
}

/**
 * 当前版本和选项的预编译包（标签 onnxruntime-v1.30.0-824dcd48a962，发布工作流打印的 SHA256SUMS）。
 * 改了 ONNXRUNTIME_SOURCE 或 ONNXRUNTIME_BUILD_OPTIONS 后单元测试会失败：推送新标签发布、把这里换成新的，或改回 null。
 */
export const ONNXRUNTIME_PREBUILT: PrebuiltOnnxRuntime | null = {
  key: '1.30.0-824dcd48a962',
  sha256: {
    'onnxruntime-win-x64-static.lib.gz': '748136043451c5e1f6d2238e87d2d2dbb4291c9091e53356616bcdbc3381e09d',
    'onnxruntime-LICENSE.txt': 'c250d6278f0b47a6439fb7592b08b58a55eb9f535aa49a1db63211c3f982b674',
    'onnxruntime-ThirdPartyNotices.txt': 'c53a76501ef60db6f865f20599f220761201ac4057683acefdab37d861b86622',
  },
};

export function prebuiltReleaseTag(): string {
  return `onnxruntime-v${onnxRuntimeBuildKey()}`;
}

export interface GitHubRepository {
  owner: string;
  repo: string;
}

/** 从 package.json 的 repository.url 读出仓库，下载地址不另写一份。 */
export function githubRepository(url: string): GitHubRepository {
  const match = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
  if (!match?.[1] || !match[2]) {
    throw new Error(`package.json 的 repository 不是 GitHub 仓库：${url}`);
  }
  return { owner: match[1], repo: match[2] };
}

export function prebuiltAssetUrl(repository: GitHubRepository, tag: string, asset: string): string {
  return `https://github.com/${repository.owner}/${repository.repo}/releases/download/${tag}/${asset}`;
}

/** sha256sum 的格式（「哈希  文件名」），按文件名排序。 */
export function formatSha256Sums(sums: Record<string, string>): string {
  return Object.keys(sums)
    .sort()
    .map((name) => `${sums[name]}  ${name}\n`)
    .join('');
}
