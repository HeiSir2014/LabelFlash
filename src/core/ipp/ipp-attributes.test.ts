import { describe, expect, test } from 'bun:test';
import {
  booleanValue,
  collectionAttr,
  dateTimeAttr,
  encodeDateTime,
  enumAttr,
  findAttribute,
  integerAttr,
  integerValue,
  keywordAttr,
  rangeAttr,
  resolutionAttr,
  stringValue,
  stringValues,
  textAttr,
} from './ipp-attributes';
import { VALUE_TAGS } from './ipp-constants';

describe('attribute builders', () => {
  test('build typed values', () => {
    expect(keywordAttr('sides-supported', 'one-sided')).toEqual({
      name: 'sides-supported',
      values: [{ kind: 'string', tag: VALUE_TAGS.keyword, value: 'one-sided' }],
    });
    expect(integerAttr('copies-default', 1).values).toEqual([{ kind: 'integer', value: 1 }]);
    expect(enumAttr('printer-state', 3).values).toEqual([{ kind: 'enum', value: 3 }]);
    expect(resolutionAttr('printer-resolution-default', 203).values).toEqual([
      { kind: 'resolution', x: 203, y: 203, units: 3 },
    ]);
    expect(rangeAttr('copies-supported', 1, 99).values).toEqual([{ kind: 'range', lower: 1, upper: 99 }]);
    expect(collectionAttr('media-size', [integerAttr('x-dimension', 6000)]).values).toEqual([
      { kind: 'collection', members: [{ name: 'x-dimension', values: [{ kind: 'integer', value: 6000 }] }] },
    ]);
  });

  test('encodes a dateTime in UTC with deciseconds', () => {
    const at = Date.UTC(2026, 9, 2, 3, 4, 5, 678);
    expect(encodeDateTime(at)).toEqual(Uint8Array.of(0x07, 0xea, 10, 2, 3, 4, 5, 6, 0x2b, 0, 0));
    expect(dateTimeAttr('printer-current-time', at).values[0]).toMatchObject({
      kind: 'octets',
      tag: VALUE_TAGS.dateTime,
    });
  });
});

describe('attribute readers', () => {
  const attributes = [
    textAttr('job-name', '面单'),
    keywordAttr('requested-attributes', 'printer-name', 'printer-state'),
    enumAttr('job-state', 9),
    { name: 'ipp-attribute-fidelity', values: [{ kind: 'boolean' as const, value: true }] },
    {
      name: 'mixed',
      values: [
        { kind: 'integer' as const, value: 1 },
        { kind: 'string' as const, tag: 0x44, value: 'x' },
      ],
    },
  ];

  test('find attributes and read their first value', () => {
    expect(stringValue(findAttribute(attributes, 'job-name'))).toBe('面单');
    expect(integerValue(findAttribute(attributes, 'job-state'))).toBe(9);
    expect(booleanValue(findAttribute(attributes, 'ipp-attribute-fidelity'))).toBe(true);
    expect(stringValue(findAttribute(attributes, 'missing'))).toBeNull();
    expect(integerValue(findAttribute(attributes, 'job-name'))).toBeNull();
  });

  test('read every value only when all are strings', () => {
    expect(stringValues(findAttribute(attributes, 'requested-attributes'))).toEqual(['printer-name', 'printer-state']);
    expect(stringValues(findAttribute(attributes, 'mixed'))).toBeNull();
    expect(stringValues(undefined)).toBeNull();
  });
});
