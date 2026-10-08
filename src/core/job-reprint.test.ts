import { describe, expect, test } from 'bun:test';
import { recordedFieldValues, reprintsStoredLabel } from './job-reprint';
import type { JobRecord } from './types';

const SCANNED: JobRecord = {
  id: 'job-1',
  createdAt: 1,
  raw: 'CL5640-TK-图片色-36',
  printerName: '热敏标签机',
  source: 'mobile',
  status: 'printed',
  forced: false,
  fields: [
    { name: '编码', value: 'CL5640-TK' },
    { name: '颜色', value: '图片色' },
    { name: '尺码', value: '36' },
    { name: '货架号', value: 'A-1-2-3' },
  ],
};

describe('reprintsStoredLabel', () => {
  test('scanned records are recognised again', () => {
    for (const source of ['desktop', 'mobile', 'history'] as const) {
      expect(reprintsStoredLabel({ ...SCANNED, source })).toBe(false);
    }
  });

  test('records without recognition rules reprint the stored label', () => {
    expect(reprintsStoredLabel({ ...SCANNED, source: 'api' })).toBe(true);
    expect(reprintsStoredLabel({ ...SCANNED, source: 'batch' })).toBe(true);
    // 从它们重打出来的那一张来源是「记录重打」，靠调用方、批次、PDF 位图认出来。
    expect(reprintsStoredLabel({ ...SCANNED, source: 'history', caller: 'key:k1' })).toBe(true);
    expect(reprintsStoredLabel({ ...SCANNED, source: 'history', batch: { id: 'b1', row: 1, copy: 1 } })).toBe(true);
    const pdf = { file: 'a.pdf', page: 1, piece: 1, bitmap: 'bitmap-1' };
    expect(reprintsStoredLabel({ ...SCANNED, source: 'history', pdf })).toBe(true);
  });
});

describe('recordedFieldValues', () => {
  test('gives the printed values by field name', () => {
    expect(recordedFieldValues(SCANNED)).toEqual({
      编码: 'CL5640-TK',
      颜色: '图片色',
      尺码: '36',
      货架号: 'A-1-2-3',
    });
  });

  test('leaves out empty values and records without fields', () => {
    expect(recordedFieldValues({ ...SCANNED, fields: [{ name: '货架号', value: '' }] })).toEqual({});
    const { fields: _fields, ...withoutFields } = SCANNED;
    expect(recordedFieldValues(withoutFields)).toEqual({});
  });
});
