import { describe, expect, test } from 'bun:test';
import { decodeIppMessage, encodeIppMessage, IppDecodeError, type IppMessage } from './ipp-codec';
import { GROUP_TAGS, VALUE_TAGS } from './ipp-constants';

const u16 = (value: number): number[] => [(value >> 8) & 0xff, value & 0xff];
const u32 = (value: number): number[] => [...u16(Math.floor(value / 0x10000)), ...u16(value & 0xffff)];
const ascii = (text: string): number[] => [...new TextEncoder().encode(text)];

/** 一个属性（RFC 8010 §3.1.4）：值标记、名字长度、名字、值长度、值。名字为空就是上一个属性的又一个值。 */
function attribute(tag: number, name: string, value: readonly number[]): number[] {
  const nameBytes = ascii(name);
  return [tag, ...u16(nameBytes.length), ...nameBytes, ...u16(value.length), ...value];
}

/** 集合里的成员名（RFC 8010 §3.1.6）：memberAttrName，名字长度 0，值是成员名。 */
const member = (name: string): number[] => attribute(VALUE_TAGS.memberAttrName, '', ascii(name));
const END_COLLECTION = [VALUE_TAGS.endCollection, ...u16(0), ...u16(0)];

/** RFC 8010 附录 A.1：Print-Job 请求，后面跟着文档。 */
// biome-ignore format: 按 RFC 8010 附录 A 的表格逐行对照
const PRINT_JOB_REQUEST = Uint8Array.from([
  0x01, 0x01, // version-number 1.1
  ...u16(0x0002), // operation-id Print-Job
  ...u32(1), // request-id
  0x01, // operation-attributes-tag
  ...attribute(0x47, 'attributes-charset', ascii('utf-8')),
  ...attribute(0x48, 'attributes-natural-language', ascii('en-us')),
  ...attribute(0x45, 'printer-uri', ascii('ipp://printer.example.com/ipp/print/pinetree')),
  ...attribute(0x42, 'job-name', ascii('foobar')),
  ...attribute(0x22, 'ipp-attribute-fidelity', [0x01]),
  0x02, // job-attributes-tag
  ...attribute(0x21, 'copies', u32(20)),
  ...attribute(0x44, 'sides', ascii('two-sided-long-edge')),
  0x03, // end-of-attributes-tag
  ...ascii('%!PS...'),
]);

/** RFC 8010 附录 A.2：Print-Job 成功的回复。 */
// biome-ignore format: 按 RFC 8010 附录 A 的表格逐行对照
const PRINT_JOB_RESPONSE = Uint8Array.from([
  0x01, 0x01,
  ...u16(0x0000), // successful-ok
  ...u32(1),
  0x01,
  ...attribute(0x47, 'attributes-charset', ascii('utf-8')),
  ...attribute(0x48, 'attributes-natural-language', ascii('en-us')),
  ...attribute(0x41, 'status-message', ascii('successful-ok')),
  0x02,
  ...attribute(0x21, 'job-id', u32(147)),
  ...attribute(0x45, 'job-uri', ascii('ipp://printer.example.com/ipp/print/pinetree/147')),
  ...attribute(0x23, 'job-state', u32(3)),
  0x03,
]);

/** 只有操作属性组的请求：版本 2.0、Get-Printer-Attributes。 */
function request(...attributes: number[][]): Uint8Array {
  return Uint8Array.from([0x02, 0x00, ...u16(0x000b), ...u32(7), 0x01, ...attributes.flat(), 0x03]);
}

describe('decodeIppMessage', () => {
  // 测试里的小工具按 RFC 8010 的布局拼字节：先和规范里的前几个字节逐个对上。
  test('lays out bytes exactly as the RFC example', () => {
    expect(PRINT_JOB_REQUEST.slice(0, 12)).toEqual(
      Uint8Array.of(0x01, 0x01, 0x00, 0x02, 0x00, 0x00, 0x00, 0x01, 0x01, 0x47, 0x00, 0x12),
    );
  });

  test('decodes the Print-Job request of RFC 8010 A.1', () => {
    const { message, dataOffset } = decodeIppMessage(PRINT_JOB_REQUEST);
    expect(message.version).toEqual({ major: 1, minor: 1 });
    expect(message.code).toBe(0x0002);
    expect(message.requestId).toBe(1);
    expect(message.groups.map((group) => group.tag)).toEqual([GROUP_TAGS.operation, GROUP_TAGS.job]);
    expect(message.groups[0]?.attributes.map((item) => item.name)).toEqual([
      'attributes-charset',
      'attributes-natural-language',
      'printer-uri',
      'job-name',
      'ipp-attribute-fidelity',
    ]);
    expect(message.groups[0]?.attributes[4]?.values).toEqual([{ kind: 'boolean', value: true }]);
    expect(message.groups[1]?.attributes).toEqual([
      { name: 'copies', values: [{ kind: 'integer', value: 20 }] },
      { name: 'sides', values: [{ kind: 'string', tag: VALUE_TAGS.keyword, value: 'two-sided-long-edge' }] },
    ]);
    expect(new TextDecoder().decode(PRINT_JOB_REQUEST.subarray(dataOffset))).toBe('%!PS...');
  });

  test('encodes decoded attributes back to the same bytes', () => {
    const { message, dataOffset } = decodeIppMessage(PRINT_JOB_REQUEST);
    expect(encodeIppMessage(message)).toEqual(PRINT_JOB_REQUEST.subarray(0, dataOffset));
  });

  test('reads additional values as one attribute with several values', () => {
    const bytes = request(
      attribute(0x47, 'attributes-charset', ascii('utf-8')),
      attribute(0x44, 'requested-attributes', ascii('printer-name')),
      attribute(0x44, '', ascii('printer-state')),
    );
    expect(decodeIppMessage(bytes).message.groups[0]?.attributes[1]).toEqual({
      name: 'requested-attributes',
      values: [
        { kind: 'string', tag: VALUE_TAGS.keyword, value: 'printer-name' },
        { kind: 'string', tag: VALUE_TAGS.keyword, value: 'printer-state' },
      ],
    });
  });

  test('decodes and re-encodes a collection inside a collection', () => {
    const mediaCol = [
      ...attribute(VALUE_TAGS.begCollection, 'media-col', []),
      ...member('media-size'),
      ...attribute(VALUE_TAGS.begCollection, '', []),
      ...member('x-dimension'),
      ...attribute(VALUE_TAGS.integer, '', u32(6000)),
      ...member('y-dimension'),
      ...attribute(VALUE_TAGS.integer, '', u32(4000)),
      ...END_COLLECTION,
      ...END_COLLECTION,
    ];
    const bytes = request(mediaCol);
    const { message } = decodeIppMessage(bytes);
    expect(message.groups[0]?.attributes[0]).toEqual({
      name: 'media-col',
      values: [
        {
          kind: 'collection',
          members: [
            {
              name: 'media-size',
              values: [
                {
                  kind: 'collection',
                  members: [
                    { name: 'x-dimension', values: [{ kind: 'integer', value: 6000 }] },
                    { name: 'y-dimension', values: [{ kind: 'integer', value: 4000 }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(encodeIppMessage(message)).toEqual(bytes);
  });

  test('keeps resolutions, ranges, dates, localized text and out-of-band values', () => {
    const date = [0x07, 0xea, 10, 2, 3, 4, 5, 6, 0x2b, 0, 0];
    const localized = [...u16(5), ...ascii('zh-cn'), ...u16(6), ...new TextEncoder().encode('你好')];
    const bytes = request(
      attribute(VALUE_TAGS.resolution, 'printer-resolution-default', [...u32(203), ...u32(203), 3]),
      attribute(VALUE_TAGS.rangeOfInteger, 'copies-supported', [...u32(1), ...u32(99)]),
      attribute(VALUE_TAGS.dateTime, 'printer-current-time', date),
      attribute(VALUE_TAGS.textWithLanguage, 'printer-info', localized),
      attribute(VALUE_TAGS.noValue, 'printer-geo-location', []),
    );
    const { message } = decodeIppMessage(bytes);
    expect(message.groups[0]?.attributes.map((item) => item.values[0])).toEqual([
      { kind: 'resolution', x: 203, y: 203, units: 3 },
      { kind: 'range', lower: 1, upper: 99 },
      { kind: 'octets', tag: VALUE_TAGS.dateTime, value: Uint8Array.from(date) },
      { kind: 'localized', tag: VALUE_TAGS.textWithLanguage, language: 'zh-cn', value: '你好' },
      { kind: 'out-of-band', tag: VALUE_TAGS.noValue },
    ]);
    expect(encodeIppMessage(message)).toEqual(bytes);
  });

  test('refuses malformed requests', () => {
    const charset = attribute(0x47, 'attributes-charset', ascii('utf-8'));
    const cases: Uint8Array[] = [
      // 头不完整
      Uint8Array.of(0x02, 0x00, 0x00),
      // 没有结束标记
      request(charset).subarray(0, -1),
      // 名字长度超出数据
      Uint8Array.from([0x02, 0x00, ...u16(0x000b), ...u32(7), 0x01, 0x47, ...u16(500), ...ascii('x')]),
      // 开头就是「又一个值」
      request(attribute(0x44, '', ascii('x'))),
      // 集合里没有成员名就给值
      request([
        ...attribute(VALUE_TAGS.begCollection, 'media-col', []),
        ...attribute(0x21, '', u32(1)),
        ...END_COLLECTION,
      ]),
      // 集合没有关上
      request([...attribute(VALUE_TAGS.begCollection, 'media-col', []), ...member('x')]),
      // 集合外出现成员名
      request(member('x')),
      // 不是 UTF-8
      request(attribute(0x41, 'job-name', [0xff, 0xfe])),
      // 整数只有 3 字节
      request(attribute(0x21, 'copies', [0, 0, 1])),
      // 布尔值不是 0 或 1
      request(attribute(0x22, 'ipp-attribute-fidelity', [2])),
      // 扩展标记
      request(attribute(0x7f, 'x', u32(0x40000000))),
      // 关键字超过 255 字节
      request(attribute(0x44, 'sides', ascii('x'.repeat(256)))),
      // 组标记 0
      Uint8Array.from([0x02, 0x00, ...u16(0x000b), ...u32(7), 0x00, 0x03]),
    ];
    for (const bytes of cases) {
      expect(() => decodeIppMessage(bytes)).toThrow(IppDecodeError);
    }
  });

  test('refuses collections nested deeper than four levels', () => {
    const open = (name: string) => [...attribute(VALUE_TAGS.begCollection, name, []), ...member('m')];
    const nested = [
      ...open('a'),
      ...open(''),
      ...open(''),
      ...open(''),
      ...open(''),
      ...attribute(0x21, '', u32(1)),
      ...END_COLLECTION,
      ...END_COLLECTION,
      ...END_COLLECTION,
      ...END_COLLECTION,
      ...END_COLLECTION,
    ];
    expect(() => decodeIppMessage(request(nested))).toThrow(IppDecodeError);
  });

  test('refuses too many attributes and attribute sections over 64KB', () => {
    const many = Array.from({ length: 501 }, (_, index) => attribute(0x44, `a${index}`, ascii('x')));
    expect(() => decodeIppMessage(request(...many))).toThrow(IppDecodeError);
    const long = Array.from({ length: 70 }, (_, index) => attribute(0x41, `t${index}`, ascii('x'.repeat(1000))));
    expect(() => decodeIppMessage(request(...long))).toThrow(IppDecodeError);
  });

  test('refuses an attribute with more than 100 values', () => {
    const extra = Array.from({ length: 100 }, () => attribute(0x44, '', ascii('x')));
    expect(() => decodeIppMessage(request(attribute(0x44, 'requested-attributes', ascii('x')), ...extra))).toThrow(
      IppDecodeError,
    );
  });
});

describe('encodeIppMessage', () => {
  test('encodes the Print-Job response of RFC 8010 A.2', () => {
    const text = (tag: number, name: string, value: string) => ({
      name,
      values: [{ kind: 'string' as const, tag, value }],
    });
    const message: IppMessage = {
      version: { major: 1, minor: 1 },
      code: 0,
      requestId: 1,
      groups: [
        {
          tag: GROUP_TAGS.operation,
          attributes: [
            text(VALUE_TAGS.charset, 'attributes-charset', 'utf-8'),
            text(VALUE_TAGS.naturalLanguage, 'attributes-natural-language', 'en-us'),
            text(VALUE_TAGS.textWithoutLanguage, 'status-message', 'successful-ok'),
          ],
        },
        {
          tag: GROUP_TAGS.job,
          attributes: [
            { name: 'job-id', values: [{ kind: 'integer', value: 147 }] },
            text(VALUE_TAGS.uri, 'job-uri', 'ipp://printer.example.com/ipp/print/pinetree/147'),
            { name: 'job-state', values: [{ kind: 'enum', value: 3 }] },
          ],
        },
      ],
    };
    expect(encodeIppMessage(message)).toEqual(PRINT_JOB_RESPONSE);
  });

  test('refuses an attribute without values', () => {
    const message: IppMessage = {
      version: { major: 2, minor: 0 },
      code: 0,
      requestId: 1,
      groups: [{ tag: GROUP_TAGS.operation, attributes: [{ name: 'x', values: [] }] }],
    };
    expect(() => encodeIppMessage(message)).toThrow('has no value');
  });
});
