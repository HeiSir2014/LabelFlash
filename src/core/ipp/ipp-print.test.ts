import { describe, expect, test } from 'bun:test';
import { chooseIppCrop, ippFields } from './ipp-print';

const LABEL = { widthMm: 60, heightMm: 40 };

describe('chooseIppCrop', () => {
  test('prints the whole page when the client already laid it out on this paper', () => {
    expect(chooseIppCrop({ widthMm: 60.2, heightMm: 39.8 }, LABEL)).toBe('page');
    expect(chooseIppCrop({ widthMm: 40, heightMm: 60 }, LABEL)).toBe('page');
  });

  test('trims white space from other pages and from images', () => {
    expect(chooseIppCrop({ widthMm: 210, heightMm: 297 }, LABEL)).toBe('trim');
    expect(chooseIppCrop({ widthMm: 64, heightMm: 40 }, LABEL)).toBe('trim');
    expect(chooseIppCrop(null, LABEL)).toBe('trim');
  });
});

describe('ippFields', () => {
  test('adds the computer and the user to the PDF fields', () => {
    expect(ippFields('面单', 2, 1, { client: '192.168.1.23', user: 'zhang' })).toEqual([
      { name: '文件', value: '面单' },
      { name: '页码', value: '2' },
      { name: '第几张', value: '1' },
      { name: '电脑', value: '192.168.1.23' },
      { name: '自称用户', value: 'zhang' },
    ]);
    expect(ippFields('面单', 1, 1, { client: '192.168.1.23', user: '' }).map((field) => field.name)).not.toContain(
      '自称用户',
    );
  });
});
