/**
 * macOS 安装包的检查规则（纯函数，bun test 测试）；verify-package.ts 在 macOS 上调用系统命令，把输出交给这里判断。
 */

/** 一个安装包同时给 Intel 和 Apple 芯片用。 */
export const REQUIRED_ARCHITECTURES = ['x86_64', 'arm64'] as const;

/** lipo -archs 的输出里缺哪些架构。 */
export function missingArchitectures(lipoOutput: string): string[] {
  const present = new Set(lipoOutput.trim().split(/\s+/));
  return REQUIRED_ARCHITECTURES.filter((arch) => !present.has(arch));
}

/**
 * codesign -dv 的输出是不是 ad-hoc 签名。没有签名的程序在 Apple 芯片上根本打不开；
 * 改 fuses 会让 Electron 自带的签名失效，所以打包后必须重新签过。
 */
export function isAdHocSigned(codesignDisplay: string): boolean {
  return /^Signature=adhoc$/m.test(codesignDisplay);
}

/** 组件包 PackageInfo 里的安装位置；没写时返回 null。 */
export function installLocation(packageInfo: string): string | null {
  return /\binstall-location="([^"]*)"/.exec(packageInfo)?.[1] ?? null;
}

/**
 * pkgutil --expand 展开的文件里有没有装完后运行的脚本（把程序加进系统防火墙的允许列表）。
 * 脚本丢了不会报错，只是局域网里的电脑连不上本机接口，所以打包后核对。
 */
export function hasPostinstallScript(expandedPaths: readonly string[]): boolean {
  return expandedPaths.some((path) => /(^|[/])Scripts[/]postinstall$/.test(path));
}
