import { type DnsName, sameName } from '../../core/mdns/dns-message';

/** mDNS 里用的名字的序号：实例名后面的「 (2)」，主机名后面的「-2」。1 = 不加。 */
export interface MdnsNames {
  instanceSerial: number;
  hostSerial: number;
}

export const FIRST_NAMES: MdnsNames = { instanceSerial: 1, hostSerial: 1 };
/** 一轮里最多换到 9：再撞就先停一会儿（见 discoveryRetryDelayMs），按地址添加照样能用。 */
export const MAX_NAME_SERIAL = 9;
/** mDNS 主机名：labelflash-<实例编号前 8 位>.local，和电脑自己的名字分开，不和系统的响应器抢名字。 */
const HOST_PREFIX = 'labelflash-';

/** 自动发现失败（端口绑不上、撞名太多）后多久重试：1 分钟起，每次翻倍，最多 15 分钟，不永久放弃。 */
export const DISCOVERY_RETRY_LIMITS = { firstMs: 60_000, maxMs: 15 * 60_000 } as const;

/** 主机名的第一段。 */
export function hostLabelFor(instanceId: string, hostSerial: number): string {
  const base = `${HOST_PREFIX}${instanceId}`;
  return hostSerial > 1 ? `${base}-${hostSerial}` : base;
}

/**
 * 撞名后的新序号（RFC 6762 §9）：主机名撞了换主机名，实例名撞了换实例名；换太多次返回 null（这一轮放弃，稍后重试）。
 */
export function renamedAfterConflict(
  names: MdnsNames,
  conflicting: readonly DnsName[],
  host: DnsName,
): MdnsNames | null {
  const isHost = conflicting.some((name) => sameName(name, host));
  const isInstance = conflicting.some((name) => !sameName(name, host));
  const next = {
    instanceSerial: names.instanceSerial + (isInstance ? 1 : 0),
    hostSerial: names.hostSerial + (isHost ? 1 : 0),
  };
  return next.instanceSerial > MAX_NAME_SERIAL || next.hostSerial > MAX_NAME_SERIAL ? null : next;
}

/** 第 attempt 次（从 0 数）重试前等多久。 */
export function discoveryRetryDelayMs(attempt: number): number {
  return Math.min(DISCOVERY_RETRY_LIMITS.maxMs, DISCOVERY_RETRY_LIMITS.firstMs * 2 ** attempt);
}
