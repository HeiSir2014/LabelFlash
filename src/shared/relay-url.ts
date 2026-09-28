/**
 * 手机扫码的中转地址。项目是开源的，代码里不写任何域名：地址来自设置（配置中心里填写），
 * 没填时用构建时注入的默认值（官方安装包由 CI 注入官方中转服务的地址）。
 * 设置的校验（src/shared/settings.ts）和主进程连接中转服务（src/main/mobile/relay-endpoint.ts）共用这一份规则。
 */

/** 本机开发和测试可以用 http（浏览器把 localhost 当作安全上下文，手机页面的摄像头也能用）。 */
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1']);
/** 地址长度上限：正常的地址不到 100 个字符，挡住塞进设置里的超长字符串。 */
export const MAX_RELAY_URL_LENGTH = 2_048;

/** 合法的中转地址：https（或本机的 http），没有账号、查询串和片段，路径以 / 结尾。不合法时返回 null。 */
export function sanitizeRelayUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_RELAY_URL_LENGTH) {
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
