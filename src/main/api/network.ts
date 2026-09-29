import { isIP } from 'node:net';

const IPV4_MAPPED_PREFIX = '::ffff:';
const IPV4_LOOPBACK_PREFIX = '127.';

/** 对方是不是本机：127.0.0.0/8、::1、IPv4 映射的 127.x（监听 :: 时 IPv4 连接显示成这种形式）。 */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) {
    return false;
  }
  const plain = address.toLowerCase().startsWith(IPV4_MAPPED_PREFIX)
    ? address.slice(IPV4_MAPPED_PREFIX.length)
    : address;
  return plain === '::1' || (isIP(plain) === 4 && plain.startsWith(IPV4_LOOPBACK_PREFIX));
}

const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * 网页请求的 Host 必须是本机名加本服务的端口（防 DNS 重绑定：恶意网站把自己的域名解析到 127.0.0.1，
 * 浏览器会把它当同源放行，但 Host 仍是那个域名）。
 */
export function isLoopbackHost(host: string | undefined, port: number): boolean {
  if (host === undefined) {
    return false;
  }
  const separator = host.lastIndexOf(':');
  if (separator <= 0) {
    return false;
  }
  return LOOPBACK_HOSTNAMES.has(host.slice(0, separator).toLowerCase()) && host.slice(separator + 1) === String(port);
}

/** 能按网站记住授权的来源：http 或 https 的网站（file:// 页面、沙盒 iframe 的 Origin 是 null）。 */
export function isWebOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === origin;
  } catch {
    return false;
  }
}
