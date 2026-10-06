/**
 * 驱动清单的地址。项目开源，代码里不写域名：地址来自设置，没填时用构建时注入的默认值
 * （官方安装包由 CI 注入，见 src/main/drivers/build-defaults.ts）。清单必须带内置公钥能核对的签名才会用，
 * 地址只决定从哪里下载。
 */

/** 开发和 E2E 可以用本机的 http（清单照样要验签）。 */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
/** 正常的地址不到 200 个字符，挡住塞进设置里的超长字符串。 */
export const MAX_CATALOG_URL_LENGTH = 2_048;

/** 合法的清单地址：https（或本机的 http），没有账号和片段；查询串可以有（有的静态存储要带版本参数）。不合法返回 null。 */
export function sanitizeCatalogUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_CATALOG_URL_LENGTH) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  const isSecure = url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(url.hostname));
  if (!isSecure || url.hash !== '' || url.username !== '' || url.password !== '') {
    return null;
  }
  return url.href;
}
