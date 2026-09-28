import { isAbsolute, join, normalize, relative } from 'node:path';

/**
 * 安装版的界面通过自定义协议 app://bundle/ 提供，而不是 file://（Electron 安全清单第 18 条）：
 * 页面拿不到 file:// 的额外特权，也只能读到渲染进程构建目录里的文件。
 */
export const APP_SCHEME = 'app';
export const APP_HOST = 'bundle';
export const APP_ENTRY_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;

/** 反斜杠只在 Windows 上是路径分隔符，NUL 会截断路径：两者都没有合法用途，一律拒绝，行为不随平台变化。 */
const FORBIDDEN_PATH_CHARACTERS = /[\\\0]/;

/** 把 app://bundle/<路径> 映射到 rootDir 内的文件；主机不对、路径越界或编码非法都返回 null。 */
export function resolveBundlePath(rootDir: string, requestUrl: string): string | null {
  let pathname: string;
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) {
      return null;
    }
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (FORBIDDEN_PATH_CHARACTERS.test(pathname)) {
    return null;
  }
  const target = normalize(join(rootDir, pathname));
  const relativePath = relative(rootDir, target);
  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return null;
  }
  return target;
}
