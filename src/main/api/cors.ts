/** 预检结果让浏览器缓存 10 分钟：同一网页连续提交时不用每次都预检。 */
const PREFLIGHT_MAX_AGE_SECONDS = 600;

/**
 * 跨域响应头：只给已授权的网站。没授权的只带 Vary（响应按 Origin 不同），浏览器因此不让网页读结果。
 * privateNetworkRequested：浏览器发来了 Access-Control-Request-Private-Network（旧版 Chrome 的私有网络访问预检；
 * 新版改为「本地网络访问」权限框，不再发这个头）。
 */
export function corsHeaders(
  origin: string,
  isAuthorized: boolean,
  options: { privateNetworkRequested: boolean },
): Record<string, string> {
  const headers: Record<string, string> = { vary: 'Origin' };
  if (!isAuthorized) {
    return headers;
  }
  headers['access-control-allow-origin'] = origin;
  headers['access-control-allow-methods'] = 'GET, POST, OPTIONS';
  headers['access-control-allow-headers'] = 'authorization, content-type';
  headers['access-control-max-age'] = String(PREFLIGHT_MAX_AGE_SECONDS);
  if (options.privateNetworkRequested) {
    headers['access-control-allow-private-network'] = 'true';
  }
  return headers;
}
