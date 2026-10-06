/**
 * mDNS 用的 DNS 报文（RFC 1035 §4、RFC 6762）：只编解局域网共享要用的几种记录。
 * 收到的报文来自局域网里的任何设备，不可信：名字压缩只许往前指、跳转次数有上限，长度不对就整包丢掉（返回 null）。
 */

export const DNS_TYPES = { A: 1, PTR: 12, TXT: 16, SRV: 33, ANY: 255 } as const;
const CLASS_IN = 1;
/** 回答里类别字段的最高位是「缓存刷新」（RFC 6762 §10.2），问题里同一位是「要单播回答」（§5.4）。 */
const CLASS_TOP_BIT = 0x8000;
/** 标志位：这是回答（QR）、权威回答（AA）。 */
const FLAG_RESPONSE = 0x8000;
const FLAG_AUTHORITATIVE = 0x0400;
const HEADER_BYTES = 12;
/** 头里的几个字段：标志、四部分条数的位置。 */
const FLAGS_OFFSET = 2;
const COUNT_OFFSETS = [4, 6, 8, 10] as const;
/** 一段最长 63 字节、整个名字最长 255 字节（RFC 1035 §2.3.4）。 */
const MAX_LABEL_BYTES = 63;
const MAX_NAME_BYTES = 255;
/** 长度字节的高两位都是 1：压缩指针（RFC 1035 §4.1.4）。 */
const POINTER_FLAGS = 0xc0;
const POINTER_HIGH_MASK = 0x3f;
const POINTER_BYTES = 2;
const IPV4_BYTES = 4;
/** 类型、类别各 2 字节，TTL 4 字节，数据长度 2 字节。 */
const RECORD_FIXED_BYTES = 10;
const RECORD_CLASS_OFFSET = 2;
const RECORD_TTL_OFFSET = 4;
const RECORD_LENGTH_OFFSET = 8;
const QUESTION_FIXED_BYTES = 4;
const QUESTION_CLASS_OFFSET = 2;
/** SRV 的优先级、权重、端口各 2 字节。 */
const SRV_FIXED_BYTES = 6;
const SRV_PORT_OFFSET = 4;
const MAX_TXT_ENTRY_BYTES = 255;
const BYTE_MASK = 0xff;
const BITS_PER_BYTE = 8;
const UINT16_RANGE = 0x10000;
const UINT16_MASK = 0xffff;

export const DNS_LIMITS = {
  /** 每一部分最多 64 条：局域网里正常的查询只有几条问题、十几条已知回答。 */
  records: 64,
  /** 一个名字最多跳 16 次压缩指针。 */
  pointerJumps: 16,
} as const;

/** 名字按段存：「60×40 标签 @ 前台」是一段，里面可以有空格、中文。 */
export type DnsName = readonly string[];

/** 一条问题。 */
export interface DnsQuestion {
  name: DnsName;
  type: number;
  /** 对方要单播回答（QU 位）。 */
  unicastResponse: boolean;
}

interface RecordBase {
  name: DnsName;
  ttl: number;
}

export type DnsRecord =
  | (RecordBase & { type: 'A'; cacheFlush: boolean; address: string })
  | (RecordBase & { type: 'PTR'; target: DnsName })
  /** 优先级、权重都写 0。 */
  | (RecordBase & { type: 'SRV'; cacheFlush: boolean; port: number; target: DnsName })
  | (RecordBase & { type: 'TXT'; cacheFlush: boolean; entries: readonly Uint8Array[] })
  /** 本程序不用的类型：只留名字和类型（判断名字冲突用）。 */
  | (RecordBase & { type: 'OTHER'; code: number });

/** 一个 mDNS 报文（查询或回答）。 */
export interface DnsMessage {
  id: number;
  isResponse: boolean;
  questions: DnsQuestion[];
  answers: DnsRecord[];
  authorities: DnsRecord[];
  additionals: DnsRecord[];
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });
const UTF8_ENCODER = new TextEncoder();

function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/** DNS 名字比较只对 ASCII 字母不分大小写（RFC 1035 §2.3.3、RFC 6762 §16）。 */
export function sameName(a: DnsName, b: DnsName): boolean {
  return a.length === b.length && a.every((part, index) => asciiLower(part) === asciiLower(b[index] ?? ''));
}

/** 名字写成一行（日志用）。 */
export function nameText(name: DnsName): string {
  return name.join('.');
}

/** 记录的类型编号。 */
export function typeCode(record: DnsRecord): number {
  switch (record.type) {
    case 'A':
      return DNS_TYPES.A;
    case 'PTR':
      return DNS_TYPES.PTR;
    case 'SRV':
      return DNS_TYPES.SRV;
    case 'TXT':
      return DNS_TYPES.TXT;
    case 'OTHER':
      return record.code;
  }
}

function pushU16(out: number[], value: number): void {
  out.push((value >> BITS_PER_BYTE) & BYTE_MASK, value & BYTE_MASK);
}

function pushU32(out: number[], value: number): void {
  pushU16(out, Math.floor(value / UINT16_RANGE));
  pushU16(out, value & UINT16_MASK);
}

function nameBytes(name: DnsName): number[] {
  const out: number[] = [];
  for (const part of name) {
    const bytes = UTF8_ENCODER.encode(part);
    if (bytes.length === 0 || bytes.length > MAX_LABEL_BYTES) {
      throw new Error(`DNS label "${part}" has ${bytes.length} bytes`);
    }
    out.push(bytes.length, ...bytes);
  }
  out.push(0);
  if (out.length > MAX_NAME_BYTES) {
    throw new Error(`DNS name ${nameText(name)} is longer than ${MAX_NAME_BYTES} bytes`);
  }
  return out;
}

function recordData(record: DnsRecord): number[] {
  switch (record.type) {
    case 'A':
      return record.address.split('.').map(Number);
    case 'PTR':
      return nameBytes(record.target);
    case 'SRV': {
      const out = [0, 0, 0, 0];
      pushU16(out, record.port);
      return [...out, ...nameBytes(record.target)];
    }
    case 'TXT': {
      // 空的 TXT 也要有一个零长度的字符串（RFC 6763 §6.1）。
      if (record.entries.length === 0) {
        return [0];
      }
      const out: number[] = [];
      for (const entry of record.entries) {
        if (entry.length > MAX_TXT_ENTRY_BYTES) {
          throw new Error(`TXT entry of ${entry.length} bytes`);
        }
        out.push(entry.length, ...entry);
      }
      return out;
    }
    case 'OTHER':
      throw new Error(`cannot encode a DNS record of type ${record.code}`);
  }
}

/**
 * 编一个 mDNS 报文（不压缩名字：报文小，最多十几台打印机）。
 * @throws Error 名字、TXT 超长：是程序自己拼错了，快速失败
 */
export function encodeDnsMessage(message: DnsMessage): Uint8Array {
  const out: number[] = [];
  pushU16(out, message.id);
  pushU16(out, message.isResponse ? FLAG_RESPONSE | FLAG_AUTHORITATIVE : 0);
  for (const count of [
    message.questions.length,
    message.answers.length,
    message.authorities.length,
    message.additionals.length,
  ]) {
    pushU16(out, count);
  }
  for (const question of message.questions) {
    out.push(...nameBytes(question.name));
    pushU16(out, question.type);
    pushU16(out, CLASS_IN | (question.unicastResponse ? CLASS_TOP_BIT : 0));
  }
  for (const record of [...message.answers, ...message.authorities, ...message.additionals]) {
    out.push(...nameBytes(record.name));
    pushU16(out, typeCode(record));
    const cacheFlush = 'cacheFlush' in record && record.cacheFlush;
    pushU16(out, CLASS_IN | (cacheFlush ? CLASS_TOP_BIT : 0));
    pushU32(out, record.ttl);
    const data = recordData(record);
    pushU16(out, data.length);
    out.push(...data);
  }
  return Uint8Array.from(out);
}

/** 读一个（可能压缩的）名字；next 是名字之后的位置（遇到指针就是指针之后）。 */
function readName(bytes: Uint8Array, start: number): { labels: string[]; next: number } | null {
  const labels: string[] = [];
  let at = start;
  let next = -1;
  let jumps = 0;
  let total = 0;
  for (;;) {
    if (at >= bytes.length) {
      return null;
    }
    const length = bytes[at] ?? 0;
    if (length === 0) {
      return { labels, next: next < 0 ? at + 1 : next };
    }
    if ((length & POINTER_FLAGS) === POINTER_FLAGS) {
      if (at + 1 >= bytes.length) {
        return null;
      }
      const target = ((length & POINTER_HIGH_MASK) << BITS_PER_BYTE) | (bytes[at + 1] ?? 0);
      if (next < 0) {
        next = at + POINTER_BYTES;
      }
      // 只许往前指、跳的次数有上限：挡住指来指去的死循环。
      if (target >= at || jumps >= DNS_LIMITS.pointerJumps) {
        return null;
      }
      jumps += 1;
      at = target;
      continue;
    }
    if ((length & POINTER_FLAGS) !== 0 || length > MAX_LABEL_BYTES || at + 1 + length > bytes.length) {
      return null;
    }
    total += length + 1;
    if (total > MAX_NAME_BYTES) {
      return null;
    }
    try {
      labels.push(UTF8.decode(bytes.subarray(at + 1, at + 1 + length)));
    } catch {
      return null;
    }
    at += 1 + length;
  }
}

function readTxt(data: Uint8Array): Uint8Array[] | null {
  const entries: Uint8Array[] = [];
  let at = 0;
  while (at < data.length) {
    const length = data[at] ?? 0;
    if (at + 1 + length > data.length) {
      return null;
    }
    if (length > 0) {
      entries.push(data.slice(at + 1, at + 1 + length));
    }
    at += 1 + length;
  }
  return entries;
}

function readRecord(bytes: Uint8Array, view: DataView, start: number): { record: DnsRecord; next: number } | null {
  const name = readName(bytes, start);
  if (name === null || name.next + RECORD_FIXED_BYTES > bytes.length) {
    return null;
  }
  const fixed = name.next;
  const code = view.getUint16(fixed);
  const cacheFlush = (view.getUint16(fixed + RECORD_CLASS_OFFSET) & CLASS_TOP_BIT) !== 0;
  const ttl = view.getUint32(fixed + RECORD_TTL_OFFSET);
  const dataStart = fixed + RECORD_FIXED_BYTES;
  const next = dataStart + view.getUint16(fixed + RECORD_LENGTH_OFFSET);
  if (next > bytes.length) {
    return null;
  }
  switch (code) {
    case DNS_TYPES.A:
      return next - dataStart === IPV4_BYTES
        ? {
            record: {
              type: 'A',
              name: name.labels,
              ttl,
              cacheFlush,
              address: [...bytes.subarray(dataStart, next)].join('.'),
            },
            next,
          }
        : null;
    case DNS_TYPES.PTR: {
      const target = readName(bytes, dataStart);
      return target === null || target.next > next
        ? null
        : { record: { type: 'PTR', name: name.labels, ttl, target: target.labels }, next };
    }
    case DNS_TYPES.SRV: {
      if (next - dataStart <= SRV_FIXED_BYTES) {
        return null;
      }
      const target = readName(bytes, dataStart + SRV_FIXED_BYTES);
      return target === null || target.next > next
        ? null
        : {
            record: {
              type: 'SRV',
              name: name.labels,
              ttl,
              cacheFlush,
              port: view.getUint16(dataStart + SRV_PORT_OFFSET),
              target: target.labels,
            },
            next,
          };
    }
    case DNS_TYPES.TXT: {
      const entries = readTxt(bytes.subarray(dataStart, next));
      return entries === null ? null : { record: { type: 'TXT', name: name.labels, ttl, cacheFlush, entries }, next };
    }
    default:
      return { record: { type: 'OTHER', name: name.labels, ttl, code }, next };
  }
}

/** 解一个 mDNS 报文；格式不对、超过上限都返回 null（整包丢掉：局域网里到处是别的设备的报文，不值得记日志）。 */
export function decodeDnsMessage(bytes: Uint8Array): DnsMessage | null {
  if (bytes.length < HEADER_BYTES) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const counts = COUNT_OFFSETS.map((offset) => view.getUint16(offset));
  if (counts.some((count) => count > DNS_LIMITS.records)) {
    return null;
  }
  const [questionCount = 0, ...recordCounts] = counts;
  let at = HEADER_BYTES;
  const questions: DnsQuestion[] = [];
  for (let index = 0; index < questionCount; index += 1) {
    const name = readName(bytes, at);
    if (name === null || name.next + QUESTION_FIXED_BYTES > bytes.length) {
      return null;
    }
    questions.push({
      name: name.labels,
      type: view.getUint16(name.next),
      unicastResponse: (view.getUint16(name.next + QUESTION_CLASS_OFFSET) & CLASS_TOP_BIT) !== 0,
    });
    at = name.next + QUESTION_FIXED_BYTES;
  }
  const sections: DnsRecord[][] = [];
  for (const count of recordCounts) {
    const records: DnsRecord[] = [];
    for (let index = 0; index < count; index += 1) {
      const read = readRecord(bytes, view, at);
      if (read === null) {
        return null;
      }
      records.push(read.record);
      at = read.next;
    }
    sections.push(records);
  }
  return {
    id: view.getUint16(0),
    isResponse: (view.getUint16(FLAGS_OFFSET) & FLAG_RESPONSE) !== 0,
    questions,
    answers: sections[0] ?? [],
    authorities: sections[1] ?? [],
    additionals: sections[2] ?? [],
  };
}
