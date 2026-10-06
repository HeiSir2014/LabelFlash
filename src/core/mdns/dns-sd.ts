import type { DnsName, DnsRecord } from './dns-message';

/** DNS-SD（RFC 6763）的一个服务实例：例如「60×40 标签 @ 前台」这台 _ipp._tcp 打印机。 */
export interface ServiceAdvert {
  /** 实例名（一段，最多 63 字节，见 instanceLabel）。 */
  instance: string;
  /** 服务类型，例如 ['_ipp', '_tcp', 'local']。 */
  serviceType: DnsName;
  /** 子类型（不带 _sub），例如 ['_universal', '_print']。 */
  subtypes: readonly string[];
  port: number;
  /** TXT 里的键值，按顺序。 */
  txt: ReadonlyArray<readonly [string, string]>;
}

/** 一块网卡上要回答的全部：程序在 mDNS 里的主机名、这块网卡的地址、所有服务。 */
export interface MdnsZone {
  host: DnsName;
  address: string;
  services: readonly ServiceAdvert[];
}

/** RFC 6762 §10：主机地址、SRV 这类会随地址变的记录 120 秒，其余 75 分钟。 */
export const MDNS_TTL_SECONDS = { host: 120, other: 4500 } as const;
/** 「这台电脑有哪些服务类型」的元查询（RFC 6763 §9）。 */
export const SERVICE_ENUMERATION: DnsName = ['_services', '_dns-sd', '_udp', 'local'];
/** 实例名是一段 DNS 名字：最多 63 字节（RFC 6763 §4.1.1）。 */
export const MAX_INSTANCE_BYTES = 63;
const MAX_TXT_ENTRY_BYTES = 255;
const SUBTYPE_LABEL = '_sub';
// biome-ignore lint/suspicious/noControlCharactersInRegex: 实例名里去掉一切控制字符
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
const UTF8_ENCODER = new TextEncoder();

/** 实例名：去掉控制字符，按 UTF-8 截到 maxBytes 以内（不切开一个汉字）。 */
export function instanceLabel(text: string, maxBytes: number = MAX_INSTANCE_BYTES): string {
  let bytes = 0;
  let label = '';
  for (const char of text.replace(CONTROL_CHARACTERS, '')) {
    const size = UTF8_ENCODER.encode(char).length;
    if (bytes + size > maxBytes) {
      break;
    }
    bytes += size;
    label += char;
  }
  return label.trim();
}

/** 实例的完整名字：实例名 + 服务类型。 */
export function instanceName(service: ServiceAdvert): DnsName {
  return [service.instance, ...service.serviceType];
}

/**
 * TXT 的每一项是「键=值」（RFC 6763 §6）。
 * @throws Error 一项超过 255 字节：是程序拼的 TXT 太长，快速失败
 */
export function encodeTxt(entries: ReadonlyArray<readonly [string, string]>): Uint8Array[] {
  return entries.map(([key, value]) => {
    const bytes = UTF8_ENCODER.encode(`${key}=${value}`);
    if (bytes.length > MAX_TXT_ENTRY_BYTES) {
      throw new Error(`TXT entry ${key} has ${bytes.length} bytes, over ${MAX_TXT_ENTRY_BYTES}`);
    }
    return bytes;
  });
}

/** 一块网卡上的全部记录：服务类型的 PTR、每个实例（含子类型）的 PTR、SRV、TXT，最后是主机地址。 */
export function zoneRecords(zone: MdnsZone): DnsRecord[] {
  const records: DnsRecord[] = [];
  const types: DnsName[] = [];
  for (const service of zone.services) {
    if (!types.some((type) => type.join('.') === service.serviceType.join('.'))) {
      types.push(service.serviceType);
    }
  }
  for (const type of types) {
    records.push({ type: 'PTR', name: SERVICE_ENUMERATION, ttl: MDNS_TTL_SECONDS.other, target: type });
  }
  for (const service of zone.services) {
    const name = instanceName(service);
    records.push({ type: 'PTR', name: service.serviceType, ttl: MDNS_TTL_SECONDS.other, target: name });
    for (const subtype of service.subtypes) {
      records.push({
        type: 'PTR',
        name: [subtype, SUBTYPE_LABEL, ...service.serviceType],
        ttl: MDNS_TTL_SECONDS.other,
        target: name,
      });
    }
    records.push({
      type: 'SRV',
      name,
      ttl: MDNS_TTL_SECONDS.host,
      cacheFlush: true,
      port: service.port,
      target: zone.host,
    });
    records.push({
      type: 'TXT',
      name,
      ttl: MDNS_TTL_SECONDS.other,
      cacheFlush: true,
      entries: encodeTxt(service.txt),
    });
  }
  records.push({ type: 'A', name: zone.host, ttl: MDNS_TTL_SECONDS.host, cacheFlush: true, address: zone.address });
  return records;
}
