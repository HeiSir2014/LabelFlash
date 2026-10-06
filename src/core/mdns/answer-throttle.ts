import { type DnsRecord, nameText, typeCode } from './dns-message';

/** 同一条记录在同一块网卡上组播回答的最短间隔（RFC 6762 §6：至少 1 秒）。 */
export const MULTICAST_ANSWER_INTERVAL_MS = 1_000;
/** 记的条数超过这么多就清掉过期的：记录只有十几条，网卡几块，正常远到不了。 */
const PRUNE_SIZE = 512;

/**
 * 组播回答的限速：局域网里别的设备狂发查询，每条记录每秒每块网卡最多答一次，本程序不会被拿来放大流量。
 * 纯逻辑，时间由调用方给。
 */
export class AnswerThrottle {
  private readonly sentAt = new Map<string, number>();

  /** 这次能发的记录（过滤掉一秒内已经在这块网卡上发过的），并记下发送时间。 */
  take(iface: string, records: readonly DnsRecord[], now: number): DnsRecord[] {
    this.prune(now);
    const allowed: DnsRecord[] = [];
    for (const record of records) {
      const key = `${iface}|${typeCode(record)}|${nameText(record.name).toLowerCase()}`;
      const last = this.sentAt.get(key);
      if (last === undefined || now - last >= MULTICAST_ANSWER_INTERVAL_MS) {
        this.sentAt.set(key, now);
        allowed.push(record);
      }
    }
    return allowed;
  }

  private prune(now: number): void {
    if (this.sentAt.size < PRUNE_SIZE) {
      return;
    }
    for (const [key, at] of this.sentAt) {
      if (now - at >= MULTICAST_ANSWER_INTERVAL_MS) {
        this.sentAt.delete(key);
      }
    }
  }
}
