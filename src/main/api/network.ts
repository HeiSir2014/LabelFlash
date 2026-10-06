import { isIP } from 'node:net';

const IPV4_MAPPED_PREFIX = '::ffff:';
const IPV4_LOOPBACK_PREFIX = '127.';
/** 系统没拿到地址时自己分的链路本地地址（169.254.x.x），也是两台电脑网线直连时用的。 */
const LINK_LOCAL_PREFIX = '169.254.';

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

/**
 * 虚拟机、容器的网卡的 MAC 前缀（厂商 OUI）。这些网卡只通向本机里的虚拟机，局域网里别的电脑连不到：
 * Hyper-V / WSL、VMware、VirtualBox、Parallels、Docker、QEMU/KVM、Xen。
 */
const VIRTUAL_MAC_PREFIXES: readonly string[] = [
  '00:15:5d',
  '00:50:56',
  '00:0c:29',
  '00:05:69',
  '00:1c:14',
  '08:00:27',
  '0a:00:27',
  '00:1c:42',
  '02:42:',
  '52:54:00',
  '00:16:3e',
];
/** 代理、VPN 的隧道网卡（TUN）没有硬件地址。 */
const NO_HARDWARE_MAC = '00:00:00:00:00:00';
/** 按名称认的虚拟网卡：Windows 的 vEthernet、VMware、VirtualBox，macOS / Linux 的隧道、网桥、容器网卡。 */
const VIRTUAL_NAME_PATTERN =
  /vEthernet|VMware|VirtualBox|Hyper-V|WSL|Docker|Tailscale|ZeroTier|^(vboxnet|vmnet|virbr|veth|bridge|docker|utun|tun|tap|wg)\d*/i;

/** 局域网用的私有网段（RFC 1918）。代理的 198.18.0.0/15、运营商级 NAT 和 Tailscale 的 100.64.0.0/10 都不在里面。 */
function isPrivateIPv4(address: string): boolean {
  const [a = -1, b = -1] = address.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** os.networkInterfaces() 里用到的部分。 */
interface InterfaceAddress {
  address: string;
  family: string;
  internal: boolean;
  mac: string;
  netmask: string;
}

/** 一块局域网网卡（IPv4）。 */
export interface LanInterface {
  name: string;
  address: string;
  netmask: string;
}

/**
 * 这台电脑在局域网里的 IPv4 网卡：按网卡的特征去掉虚拟机、容器、代理和 VPN 的虚拟网卡，只留私有网段的；
 * 规则判断不了、全被去掉时退回列出所有对外的：宁可多列，也不能一个都不给。
 */
export function lanIPv4Interfaces(interfaces: NodeJS.Dict<readonly InterfaceAddress[]>): LanInterface[] {
  const external = Object.entries(interfaces).flatMap(([name, items]) =>
    (items ?? [])
      .filter((item) => item.family === 'IPv4' && !item.internal && !item.address.startsWith(LINK_LOCAL_PREFIX))
      .map((item) => ({ name, ...item })),
  );
  const physical = external.filter(
    (item) =>
      isPrivateIPv4(item.address) &&
      item.mac.toLowerCase() !== NO_HARDWARE_MAC &&
      !VIRTUAL_MAC_PREFIXES.some((prefix) => item.mac.toLowerCase().startsWith(prefix)) &&
      !VIRTUAL_NAME_PATTERN.test(item.name),
  );
  return (physical.length > 0 ? physical : external).map(({ name, address, netmask }) => ({ name, address, netmask }));
}

/** 这台电脑在局域网里的 IPv4 地址（给配置中心显示，让操作员填到别的电脑的程序里）。 */
export function lanIPv4Addresses(interfaces: NodeJS.Dict<readonly InterfaceAddress[]>): string[] {
  return lanIPv4Interfaces(interfaces).map((item) => item.address);
}

/** 去掉 IPv4 映射前缀（::ffff:192.168.1.23 → 192.168.1.23）：监听 :: 时 IPv4 连接显示成这种形式。 */
export function plainAddress(address: string): string {
  return address.toLowerCase().startsWith(IPV4_MAPPED_PREFIX) ? address.slice(IPV4_MAPPED_PREFIX.length) : address;
}

/**
 * 局域网里来的连接（局域网共享只接受这些）：私有网段（RFC 1918）、链路本地（169.254/16，两台电脑直连时用）、本机回环。
 * 共享只监听 IPv4，IPv6 一律不算；代理的 198.18/15、运营商级 NAT 和 Tailscale 的 100.64/10 都不算局域网。
 */
export function isLanClientAddress(address: string | undefined): boolean {
  if (address === undefined) {
    return false;
  }
  const plain = plainAddress(address);
  return (
    isIP(plain) === 4 &&
    (isPrivateIPv4(plain) || plain.startsWith(LINK_LOCAL_PREFIX) || plain.startsWith(IPV4_LOOPBACK_PREFIX))
  );
}

/**
 * 对方是不是这台电脑所在网段里的（局域网共享、mDNS 只理这些）：和选中的某块局域网网卡同一个子网。
 * 本机回环只在开发 / E2E 的开关打开时算（安装版里本机不需要连自己的共享打印机）。
 */
export function isOnLanSubnet(
  address: string | undefined,
  interfaces: readonly LanInterface[],
  allowLoopback: boolean,
): boolean {
  if (address === undefined) {
    return false;
  }
  const plain = plainAddress(address);
  if (isIP(plain) !== 4) {
    return false;
  }
  if (plain.startsWith(IPV4_LOOPBACK_PREFIX)) {
    return allowLoopback;
  }
  return interfaces.some((iface) => isSameSubnet(iface.address, plain, iface.netmask));
}

const BITS_PER_OCTET = 8;
const OCTET_RANGE = 2 ** BITS_PER_OCTET;

function ipv4Number(address: string): number {
  return address.split('.').reduce((sum, part) => sum * OCTET_RANGE + Number(part), 0);
}

/** 两个 IPv4 地址在不在掩码划出的同一个子网里（mDNS 按对方的地址选从哪块网卡回答）。 */
export function isSameSubnet(a: string, b: string, netmask: string): boolean {
  const mask = ipv4Number(netmask);
  return (ipv4Number(a) & mask) >>> 0 === (ipv4Number(b) & mask) >>> 0;
}
