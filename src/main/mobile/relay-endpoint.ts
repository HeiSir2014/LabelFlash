/**
 * 中转服务的地址。项目是开源的，代码里不写任何域名：
 * 地址来自设置（配置中心里填写），没填时用构建时注入的默认值（官方安装包由 CI 注入官方中转服务的地址）。
 */

/** 本机开发和测试可以用 http（浏览器把 localhost 当作安全上下文，手机页面的摄像头也能用）。 */
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1']);

/** 合法的中转地址：https（或本机的 http），没有查询串和片段，路径以 / 结尾。不合法时返回 null。 */
export function sanitizeRelayUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  const isSecure = url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTNAMES.has(url.hostname));
  if (!isSecure || url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') {
    return null;
  }
  if (!url.pathname.endsWith('/')) {
    url.pathname = `${url.pathname}/`;
  }
  return url.href;
}

/** 设置优先，构建默认值兜底；都没有（或不合法）时为 null，界面提示去配置中心填写。 */
export function resolveRelayBase(sources: { setting: string | null; buildDefault: string | null }): URL | null {
  const href = sanitizeRelayUrl(sources.setting) ?? sanitizeRelayUrl(sources.buildDefault);
  return href === null ? null : new URL(href);
}

export function desktopSocketUrl(base: URL): string {
  const url = new URL('ws/desktop', base);
  url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}
