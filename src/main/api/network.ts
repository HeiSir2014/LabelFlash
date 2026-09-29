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

/** 系统没拿到地址时自己分的链路本地地址（169.254.x.x），别的电脑一般连不上。 */
const LINK_LOCAL_PREFIX = '169.254.';

/** 这台电脑在局域网里的 IPv4 地址（os.networkInterfaces() 的结果），给配置中心显示。 */
/** os.networkInterfaces() 里用到的部分。 */
interface InterfaceAddress {
  address: string;
  family: string;
  internal: boolean;
}

export function lanIPv4Addresses(interfaces: NodeJS.Dict<readonly InterfaceAddress[]>): string[] {
  return Object.values(interfaces).flatMap((items) =>
    (items ?? [])
      .filter((item) => item.family === 'IPv4' && !item.internal && !item.address.startsWith(LINK_LOCAL_PREFIX))
      .map((item) => item.address),
  );
}
