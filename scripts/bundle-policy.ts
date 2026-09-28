/**
 * 主进程 / preload 产物允许引用的包外模块。除了运行时自带的模块，其余依赖必须全部内联进 bundle，
 * 安装包里不带 node_modules（见 electron.vite.config.ts）。
 */

/**
 * ws 的可选原生加速模块：ws 在 try/catch 里 require 它们，失败就改用纯 JS 实现。
 * 不能交给 Vite 内联：Vite 会把缺失的可选依赖替换成空对象，require 不再抛错，
 * ws 以为装上了，发送 48 字节以上的帧时调用 bufferUtil.mask 直接报 TypeError（语音合成全部失败）。
 * 保持外部 require，运行时找不到就走 ws 自己的回退路径。
 */
export const OPTIONAL_NATIVE_MODULES: readonly string[] = ['bufferutil', 'utf-8-validate'];

const SPECIFIER_PATTERN = /\b(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/g;

/** 产物里引用的、既不是相对路径也不在允许名单里的模块名（排序去重）。 */
export function findExternalSpecifiers(code: string, isAllowed: (specifier: string) => boolean): string[] {
  const found = new Set<string>();
  for (const [, specifier = ''] of code.matchAll(SPECIFIER_PATTERN)) {
    const isRelative = specifier.startsWith('.') || specifier.startsWith('/');
    if (!isRelative && !isAllowed(specifier)) {
      found.add(specifier);
    }
  }
  return [...found].sort();
}
