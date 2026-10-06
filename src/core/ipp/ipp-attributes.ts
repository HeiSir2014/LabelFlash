import { DATE_TIME_BYTES, type IppAttribute, type IppValue } from './ipp-codec';
import { RESOLUTION_DPI, VALUE_TAGS } from './ipp-constants';

/** 建属性、读属性的小工具：拼回复、读请求时不用到处写 { kind, tag, value }。 */

/** dateTime 的时区方向：程序一律写 UTC（+00:00）。 */
const PLUS_SIGN = 0x2b;
const MS_PER_DECISECOND = 100;
/** dateTime 里年份占前 2 字节，其余字段从第 2 字节开始。 */
const DATE_FIELDS_OFFSET = 2;

function strings(tag: number, name: string, values: readonly string[]): IppAttribute {
  return { name, values: values.map((value): IppValue => ({ kind: 'string', tag, value })) };
}

/** keyword 类属性（1setOf 时传多个值）。 */
export function keywordAttr(name: string, ...values: string[]): IppAttribute {
  return strings(VALUE_TAGS.keyword, name, values);
}

/** textWithoutLanguage。 */
export function textAttr(name: string, ...values: string[]): IppAttribute {
  return strings(VALUE_TAGS.textWithoutLanguage, name, values);
}

/** nameWithoutLanguage。 */
export function nameAttr(name: string, ...values: string[]): IppAttribute {
  return strings(VALUE_TAGS.nameWithoutLanguage, name, values);
}

/** uri。 */
export function uriAttr(name: string, ...values: string[]): IppAttribute {
  return strings(VALUE_TAGS.uri, name, values);
}

/** charset。 */
export function charsetAttr(name: string, ...values: string[]): IppAttribute {
  return strings(VALUE_TAGS.charset, name, values);
}

/** naturalLanguage。 */
export function languageAttr(name: string, ...values: string[]): IppAttribute {
  return strings(VALUE_TAGS.naturalLanguage, name, values);
}

/** mimeMediaType。 */
export function mimeTypeAttr(name: string, ...values: string[]): IppAttribute {
  return strings(VALUE_TAGS.mimeMediaType, name, values);
}

/** integer。 */
export function integerAttr(name: string, ...values: number[]): IppAttribute {
  return { name, values: values.map((value): IppValue => ({ kind: 'integer', value })) };
}

/** enum。 */
export function enumAttr(name: string, ...values: number[]): IppAttribute {
  return { name, values: values.map((value): IppValue => ({ kind: 'enum', value })) };
}

/** boolean。 */
export function booleanAttr(name: string, value: boolean): IppAttribute {
  return { name, values: [{ kind: 'boolean', value }] };
}

/** 横竖相同的分辨率（每英寸点数）。 */
export function resolutionAttr(name: string, ...dpis: number[]): IppAttribute {
  return {
    name,
    values: dpis.map((dpi): IppValue => ({ kind: 'resolution', x: dpi, y: dpi, units: RESOLUTION_DPI })),
  };
}

/** rangeOfInteger。 */
export function rangeAttr(name: string, lower: number, upper: number): IppAttribute {
  return { name, values: [{ kind: 'range', lower, upper }] };
}

/** 每个参数是一个集合（它的成员）；多个就是 1setOf collection。 */
export function collectionAttr(name: string, ...collections: IppAttribute[][]): IppAttribute {
  return { name, values: collections.map((members): IppValue => ({ kind: 'collection', members })) };
}

/** dateTime（按 UTC 写）。 */
export function dateTimeAttr(name: string, epochMs: number): IppAttribute {
  return { name, values: [{ kind: 'octets', tag: VALUE_TAGS.dateTime, value: encodeDateTime(epochMs) }] };
}

/** 没有值本身的属性（例如 printer-geo-location 未知）。 */
export function outOfBandAttr(name: string, tag: number): IppAttribute {
  return { name, values: [{ kind: 'out-of-band', tag }] };
}

/** RFC 2579 DateAndTime：年（2 字节）、月、日、时、分、秒、十分之一秒、时区方向、时、分。写 UTC。 */
export function encodeDateTime(epochMs: number): Uint8Array {
  const date = new Date(epochMs);
  const bytes = new Uint8Array(DATE_TIME_BYTES);
  new DataView(bytes.buffer).setUint16(0, date.getUTCFullYear());
  bytes.set(
    [
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      Math.floor(date.getUTCMilliseconds() / MS_PER_DECISECOND),
      PLUS_SIGN,
      0,
      0,
    ],
    DATE_FIELDS_OFFSET,
  );
  return bytes;
}

/** 按名字找属性（同名的只认第一个）。 */
export function findAttribute(attributes: readonly IppAttribute[], name: string): IppAttribute | undefined {
  return attributes.find((attribute) => attribute.name === name);
}

/** 第一个值是文字（带不带语言都行）就返回它；没有或不是文字返回 null。 */
export function stringValue(attribute: IppAttribute | undefined): string | null {
  const value = attribute?.values[0];
  return value?.kind === 'string' || value?.kind === 'localized' ? value.value : null;
}

/** 全部值都是文字才返回；有一个不是就返回 null（调用方按「格式不对」处理）。 */
export function stringValues(attribute: IppAttribute | undefined): string[] | null {
  if (attribute === undefined) {
    return null;
  }
  const values: string[] = [];
  for (const value of attribute.values) {
    if (value.kind !== 'string' && value.kind !== 'localized') {
      return null;
    }
    values.push(value.value);
  }
  return values;
}

/** 第一个值是 integer 或 enum 就返回它。 */
export function integerValue(attribute: IppAttribute | undefined): number | null {
  const value = attribute?.values[0];
  return value?.kind === 'integer' || value?.kind === 'enum' ? value.value : null;
}

/** 第一个值是 boolean 就返回它。 */
export function booleanValue(attribute: IppAttribute | undefined): boolean | null {
  const value = attribute?.values[0];
  return value?.kind === 'boolean' ? value.value : null;
}
