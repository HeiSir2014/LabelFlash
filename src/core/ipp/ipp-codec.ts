import { EXTENSION_TAG, FIRST_VALUE_TAG, GROUP_TAGS, LAST_OUT_OF_BAND_TAG, VALUE_TAGS } from './ipp-constants';

/**
 * IPP 报文的二进制编解码（RFC 8010 §3）。请求来自局域网里的任何电脑，不可信：
 * 每一处长度都核对，属性数、值数、集合层数、属性部分的总字节数都有上限，不对就抛 IppDecodeError。
 */

/** 一个属性值。字符串类（文字、名字、关键字、网址、字符集、语言、MIME 类型）按 UTF-8 解成字符串，tag 记原来的类型。 */
export type IppValue =
  | { kind: 'integer'; value: number }
  | { kind: 'enum'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'string'; tag: number; value: string }
  /** textWithLanguage、nameWithLanguage：带语言的文字。 */
  | { kind: 'localized'; tag: number; language: string; value: string }
  /** octetString、dateTime，以及本程序不认识的类型：原样保留字节。 */
  | { kind: 'octets'; tag: number; value: Uint8Array }
  /** units：3 = 每英寸点数，4 = 每厘米点数。 */
  | { kind: 'resolution'; x: number; y: number; units: number }
  | { kind: 'range'; lower: number; upper: number }
  | { kind: 'collection'; members: IppAttribute[] }
  /** unsupported、unknown、no-value 这类没有值本身的。 */
  | { kind: 'out-of-band'; tag: number };

/** 一个属性：名字和它的值。 */
export interface IppAttribute {
  name: string;
  /** 至少一个值；多个值就是 1setOf。 */
  values: IppValue[];
}

/** 一组属性（操作、任务、打印机……）。 */
export interface IppGroup {
  /** GROUP_TAGS 里的一个（也可能是别的 0x01–0x0F，例如文档组）。 */
  tag: number;
  attributes: IppAttribute[];
}

export interface IppVersion {
  major: number;
  minor: number;
}

/** 一个 IPP 请求或回复的属性部分。 */
export interface IppMessage {
  version: IppVersion;
  /** 请求里是操作编号，回复里是状态码。 */
  code: number;
  requestId: number;
  groups: IppGroup[];
}

/** 解出来的报文和文档数据开始的位置。 */
export interface DecodedIpp {
  message: IppMessage;
  /** 属性部分之后、文档数据开始的位置。 */
  dataOffset: number;
}

export const IPP_DECODE_LIMITS = {
  /** 属性部分最多 64KB：Get-Printer-Attributes 的请求只有几百字节，Print-Job 的属性也就一两 KB。 */
  headerBytes: 64 * 1024,
  /** 一个请求最多 500 个属性（含集合里的成员）：实测客户端的请求不到 50 个。 */
  attributes: 500,
  /** 一个属性最多 100 个值：requested-attributes 列全也只有几十个。 */
  values: 100,
  /** 集合最多套 4 层：media-col 里的 media-size 才 2 层。 */
  collectionDepth: 4,
} as const;

/** 字符串类的值和它们的长度上限（字节，RFC 8011 §5.1）。 */
const STRING_LIMITS: ReadonlyMap<number, number> = new Map<number, number>([
  [VALUE_TAGS.textWithoutLanguage, 1023],
  [VALUE_TAGS.nameWithoutLanguage, 255],
  [VALUE_TAGS.keyword, 255],
  [VALUE_TAGS.uri, 1023],
  [VALUE_TAGS.uriScheme, 63],
  [VALUE_TAGS.charset, 63],
  [VALUE_TAGS.naturalLanguage, 63],
  [VALUE_TAGS.mimeMediaType, 255],
]);
/** 属性名、成员名最长 255 字节。 */
const MAX_NAME_BYTES = 255;
/** octetString 和不认识的类型最长 1023 字节（RFC 8011 §5.1.11）。 */
const MAX_OCTETS = 1023;
/** 带语言的文字：语言最长 63 字节，文字最长 1023 字节。 */
const MAX_LANGUAGE_BYTES = 63;
const MAX_LOCALIZED_TEXT_BYTES = 1023;
const INTEGER_BYTES = 4;
/** resolution：横、竖各 4 字节，单位 1 字节。 */
const RESOLUTION_BYTES = 9;
const RESOLUTION_Y_OFFSET = 4;
const RESOLUTION_UNITS_OFFSET = 8;
/** rangeOfInteger：下限、上限各 4 字节。 */
const RANGE_BYTES = 8;
const RANGE_UPPER_OFFSET = 4;
/** dateTime 固定 11 字节（RFC 2579 DateAndTime）。 */
export const DATE_TIME_BYTES = 11;
const LENGTH_FIELD_BYTES = 2;
const UINT16_MAX = 0xffff;
/** 一般的回复 1–4KB：写缓冲从 1KB 起，不够就翻倍。 */
const INITIAL_WRITER_BYTES = 1024;
const BYTE_MASK = 0xff;
const BITS_PER_BYTE = 8;
const HEX = 16;

/** 报文不合规格：HTTP 层据此回「请求有误」。 */
export class IppDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IppDecodeError';
  }
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });
const UTF8_ENCODER = new TextEncoder();

/** 按顺序读字节，越过 end 就抛错（属性部分不许越过 64KB）。 */
class Reader {
  private offset = 0;
  private readonly view: DataView;

  constructor(
    private readonly bytes: Uint8Array,
    private readonly end: number,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get position(): number {
    return this.offset;
  }

  u8(): number {
    this.need(1);
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  u16(): number {
    this.need(LENGTH_FIELD_BYTES);
    const value = this.view.getUint16(this.offset);
    this.offset += LENGTH_FIELD_BYTES;
    return value;
  }

  i32(): number {
    this.need(INTEGER_BYTES);
    const value = this.view.getInt32(this.offset);
    this.offset += INTEGER_BYTES;
    return value;
  }

  take(length: number): Uint8Array {
    this.need(length);
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  private need(count: number): void {
    if (this.offset + count > this.end) {
      throw new IppDecodeError(`the attributes end early or are longer than allowed (at byte ${this.offset})`);
    }
  }
}

interface Counter {
  attributes: number;
}

/**
 * 解出 IPP 报文的属性部分；dataOffset 之后是文档数据（PDF、图片、光栅），这里不碰。
 * 属性部分超过 IPP_DECODE_LIMITS.headerBytes 还没结束就当作坏请求。
 * @throws IppDecodeError 任何一处不合规格
 */
export function decodeIppMessage(bytes: Uint8Array): DecodedIpp {
  const reader = new Reader(bytes, Math.min(bytes.length, IPP_DECODE_LIMITS.headerBytes));
  const version = { major: reader.u8(), minor: reader.u8() };
  const code = reader.u16();
  const requestId = reader.i32();
  const counter: Counter = { attributes: 0 };
  const groups: IppGroup[] = [];
  let tag = reader.u8();
  while (tag !== GROUP_TAGS.end) {
    if (tag === 0 || tag >= FIRST_VALUE_TAG) {
      throw new IppDecodeError(`expected a group tag, got 0x${tag.toString(HEX)}`);
    }
    const group: IppGroup = { tag, attributes: [] };
    groups.push(group);
    tag = readGroup(reader, group.attributes, counter);
  }
  return { message: { version, code, requestId, groups }, dataOffset: reader.position };
}

/** 读一组属性，返回读到的下一个组标记。 */
function readGroup(reader: Reader, attributes: IppAttribute[], counter: Counter): number {
  for (;;) {
    const tag = reader.u8();
    if (tag < FIRST_VALUE_TAG) {
      return tag;
    }
    const name = readText(reader, MAX_NAME_BYTES);
    const value = readValue(reader, tag, counter, 0);
    if (name !== '') {
      countAttribute(counter);
      attributes.push({ name, values: [value] });
      continue;
    }
    // 名字长度为 0：上一个属性的又一个值（1setOf）。
    const previous = attributes.at(-1);
    if (previous === undefined) {
      throw new IppDecodeError('an additional value has no attribute');
    }
    addValue(previous, value);
  }
}

function readValue(reader: Reader, tag: number, counter: Counter, depth: number): IppValue {
  if (tag === EXTENSION_TAG) {
    throw new IppDecodeError('extension tags are not supported');
  }
  if (tag === VALUE_TAGS.memberAttrName || tag === VALUE_TAGS.endCollection) {
    throw new IppDecodeError('collection syntax outside a collection');
  }
  const length = reader.u16();
  if (tag === VALUE_TAGS.begCollection) {
    // 规范要求长度为 0；个别客户端填了别的，跳过不看。
    reader.take(length);
    if (depth + 1 > IPP_DECODE_LIMITS.collectionDepth) {
      throw new IppDecodeError(`collections nested deeper than ${IPP_DECODE_LIMITS.collectionDepth}`);
    }
    return { kind: 'collection', members: readCollection(reader, counter, depth + 1) };
  }
  return decodeValue(tag, reader.take(length));
}

/** 集合（RFC 8010 §3.1.6）：成员名（memberAttrName）后面跟它的值，直到 endCollection。 */
function readCollection(reader: Reader, counter: Counter, depth: number): IppAttribute[] {
  const members: IppAttribute[] = [];
  for (;;) {
    const tag = reader.u8();
    if (tag < FIRST_VALUE_TAG) {
      throw new IppDecodeError('a collection is not closed');
    }
    if (reader.u16() !== 0) {
      throw new IppDecodeError('collection members must not have a name field');
    }
    if (tag === VALUE_TAGS.endCollection) {
      reader.take(reader.u16());
      if (members.some((member) => member.values.length === 0)) {
        throw new IppDecodeError('a collection member has no value');
      }
      return members;
    }
    if (tag === VALUE_TAGS.memberAttrName) {
      const name = readText(reader, MAX_NAME_BYTES);
      if (name === '') {
        throw new IppDecodeError('a collection member has an empty name');
      }
      countAttribute(counter);
      members.push({ name, values: [] });
      continue;
    }
    const member = members.at(-1);
    if (member === undefined) {
      throw new IppDecodeError('a collection value has no member name');
    }
    addValue(member, readValue(reader, tag, counter, depth));
  }
}

function decodeValue(tag: number, bytes: Uint8Array): IppValue {
  if (tag >= FIRST_VALUE_TAG && tag <= LAST_OUT_OF_BAND_TAG) {
    return { kind: 'out-of-band', tag };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  switch (tag) {
    case VALUE_TAGS.integer:
      expectLength(bytes, INTEGER_BYTES);
      return { kind: 'integer', value: view.getInt32(0) };
    case VALUE_TAGS.enum:
      expectLength(bytes, INTEGER_BYTES);
      return { kind: 'enum', value: view.getInt32(0) };
    case VALUE_TAGS.boolean: {
      expectLength(bytes, 1);
      const byte = view.getUint8(0);
      if (byte > 1) {
        throw new IppDecodeError(`boolean value ${byte}`);
      }
      return { kind: 'boolean', value: byte === 1 };
    }
    case VALUE_TAGS.resolution:
      expectLength(bytes, RESOLUTION_BYTES);
      return {
        kind: 'resolution',
        x: view.getInt32(0),
        y: view.getInt32(RESOLUTION_Y_OFFSET),
        units: view.getInt8(RESOLUTION_UNITS_OFFSET),
      };
    case VALUE_TAGS.rangeOfInteger:
      expectLength(bytes, RANGE_BYTES);
      return { kind: 'range', lower: view.getInt32(0), upper: view.getInt32(RANGE_UPPER_OFFSET) };
    case VALUE_TAGS.textWithLanguage:
    case VALUE_TAGS.nameWithLanguage:
      return readLocalized(tag, bytes);
    default: {
      const limit = STRING_LIMITS.get(tag);
      if (limit !== undefined) {
        checkLength(bytes.length, limit);
        return { kind: 'string', tag, value: decodeUtf8(bytes) };
      }
      if (tag === VALUE_TAGS.dateTime) {
        expectLength(bytes, DATE_TIME_BYTES);
      } else {
        checkLength(bytes.length, MAX_OCTETS);
      }
      // 复制一份：不留着整个请求的缓冲区（后面可能跟着 50MB 的文档）。
      return { kind: 'octets', tag, value: bytes.slice() };
    }
  }
}

function readLocalized(tag: number, bytes: Uint8Array): IppValue {
  const reader = new Reader(bytes, bytes.length);
  const language = readText(reader, MAX_LANGUAGE_BYTES);
  const value = readText(reader, MAX_LOCALIZED_TEXT_BYTES);
  if (reader.position !== bytes.length) {
    throw new IppDecodeError('a localized value has trailing bytes');
  }
  return { kind: 'localized', tag, language, value };
}

/** 2 字节长度 + UTF-8 文字。 */
function readText(reader: Reader, maxBytes: number): string {
  const length = reader.u16();
  checkLength(length, maxBytes);
  return decodeUtf8(reader.take(length));
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return UTF8.decode(bytes);
  } catch {
    throw new IppDecodeError('text is not valid UTF-8');
  }
}

function checkLength(length: number, maxBytes: number): void {
  if (length > maxBytes) {
    throw new IppDecodeError(`a name or value of ${length} bytes is over ${maxBytes}`);
  }
}

function expectLength(bytes: Uint8Array, length: number): void {
  if (bytes.length !== length) {
    throw new IppDecodeError(`expected ${length} value bytes, got ${bytes.length}`);
  }
}

function countAttribute(counter: Counter): void {
  counter.attributes += 1;
  if (counter.attributes > IPP_DECODE_LIMITS.attributes) {
    throw new IppDecodeError(`more than ${IPP_DECODE_LIMITS.attributes} attributes`);
  }
}

function addValue(attribute: IppAttribute, value: IppValue): void {
  if (attribute.values.length >= IPP_DECODE_LIMITS.values) {
    throw new IppDecodeError(`attribute ${attribute.name} has more than ${IPP_DECODE_LIMITS.values} values`);
  }
  attribute.values.push(value);
}

/** 按顺序写字节，空间不够时翻倍。 */
class Writer {
  private buffer = new Uint8Array(INITIAL_WRITER_BYTES);
  private length = 0;

  u8(value: number): void {
    this.reserve(1);
    this.buffer[this.length] = value & BYTE_MASK;
    this.length += 1;
  }

  u16(value: number): void {
    this.u8(value >> BITS_PER_BYTE);
    this.u8(value);
  }

  i32(value: number): void {
    this.reserve(INTEGER_BYTES);
    new DataView(this.buffer.buffer).setInt32(this.length, value);
    this.length += INTEGER_BYTES;
  }

  bytes(value: Uint8Array): void {
    this.reserve(value.length);
    this.buffer.set(value, this.length);
    this.length += value.length;
  }

  /** 2 字节长度 + 内容。 */
  sized(value: Uint8Array): void {
    if (value.length > UINT16_MAX) {
      throw new Error(`IPP value of ${value.length} bytes does not fit a 2-byte length`);
    }
    this.u16(value.length);
    this.bytes(value);
  }

  result(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }

  private reserve(count: number): void {
    if (this.length + count <= this.buffer.length) {
      return;
    }
    let size = this.buffer.length * 2;
    while (size < this.length + count) {
      size *= 2;
    }
    const next = new Uint8Array(size);
    next.set(this.buffer.subarray(0, this.length));
    this.buffer = next;
  }
}

/**
 * 把 IPP 报文编成字节（只有属性部分，文档数据由调用方接在后面）。
 * @throws Error 属性没有值、值超长：是程序自己拼错了回复，快速失败
 */
export function encodeIppMessage(message: IppMessage): Uint8Array {
  const writer = new Writer();
  writer.u8(message.version.major);
  writer.u8(message.version.minor);
  writer.u16(message.code);
  writer.i32(message.requestId);
  for (const group of message.groups) {
    writer.u8(group.tag);
    for (const attribute of group.attributes) {
      writeAttribute(writer, attribute);
    }
  }
  writer.u8(GROUP_TAGS.end);
  return writer.result();
}

function writeAttribute(writer: Writer, attribute: IppAttribute): void {
  if (attribute.values.length === 0) {
    throw new Error(`IPP attribute ${attribute.name} has no value`);
  }
  for (const [index, value] of attribute.values.entries()) {
    writeValue(writer, index === 0 ? attribute.name : '', value);
  }
}

function writeValue(writer: Writer, name: string, value: IppValue): void {
  writer.u8(tagOf(value));
  writer.sized(UTF8_ENCODER.encode(name));
  switch (value.kind) {
    case 'integer':
    case 'enum':
      writer.u16(INTEGER_BYTES);
      writer.i32(value.value);
      return;
    case 'boolean':
      writer.u16(1);
      writer.u8(value.value ? 1 : 0);
      return;
    case 'string':
      writer.sized(UTF8_ENCODER.encode(value.value));
      return;
    case 'localized': {
      const language = UTF8_ENCODER.encode(value.language);
      const text = UTF8_ENCODER.encode(value.value);
      writer.u16(LENGTH_FIELD_BYTES * 2 + language.length + text.length);
      writer.sized(language);
      writer.sized(text);
      return;
    }
    case 'octets':
      writer.sized(value.value);
      return;
    case 'resolution':
      writer.u16(RESOLUTION_BYTES);
      writer.i32(value.x);
      writer.i32(value.y);
      writer.u8(value.units);
      return;
    case 'range':
      writer.u16(RANGE_BYTES);
      writer.i32(value.lower);
      writer.i32(value.upper);
      return;
    case 'out-of-band':
      writer.u16(0);
      return;
    case 'collection':
      writer.u16(0);
      for (const member of value.members) {
        if (member.values.length === 0) {
          throw new Error(`IPP collection member ${member.name} has no value`);
        }
        writer.u8(VALUE_TAGS.memberAttrName);
        writer.u16(0);
        writer.sized(UTF8_ENCODER.encode(member.name));
        for (const memberValue of member.values) {
          writeValue(writer, '', memberValue);
        }
      }
      writer.u8(VALUE_TAGS.endCollection);
      writer.u16(0);
      writer.u16(0);
      return;
  }
}

function tagOf(value: IppValue): number {
  switch (value.kind) {
    case 'integer':
      return VALUE_TAGS.integer;
    case 'enum':
      return VALUE_TAGS.enum;
    case 'boolean':
      return VALUE_TAGS.boolean;
    case 'resolution':
      return VALUE_TAGS.resolution;
    case 'range':
      return VALUE_TAGS.rangeOfInteger;
    case 'collection':
      return VALUE_TAGS.begCollection;
    case 'string':
    case 'localized':
    case 'octets':
    case 'out-of-band':
      return value.tag;
  }
}
