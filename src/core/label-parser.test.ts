import { describe, expect, test } from 'bun:test';
import { MAX_RAW_LENGTH, parseLabel } from './label-parser';

describe('parseLabel', () => {
  test('splits code, color and size from the right', () => {
    expect(parseLabel('CL5640-TK-图片色-36')).toEqual({
      raw: 'CL5640-TK-图片色-36',
      code: 'CL5640-TK',
      color: '图片色',
      size: '36',
    });
  });

  test.each(['S', 'M', 'L', 'XL', 'XXL', '3XL', '均码', '36.5', 'F'])(
    'accepts letter and text sizes like %p',
    (size) => {
      expect(parseLabel(`CL5640-TK-图片色-${size}`)?.size).toBe(size);
    },
  );

  test('keeps every extra hyphen inside the code', () => {
    expect(parseLabel('A-B-C-红-XL')).toEqual({ raw: 'A-B-C-红-XL', code: 'A-B-C', color: '红', size: 'XL' });
  });

  test('trims whitespace and line endings sent by scanners', () => {
    expect(parseLabel('  CL1-黑-40\r\n')?.raw).toBe('CL1-黑-40');
  });

  test.each(['', '   ', 'CL5640', 'CL5640-36', '-红-36', 'CL1--36', 'CL1-红-', 'CL1- -36'])(
    'rejects malformed input %p',
    (input) => {
      expect(parseLabel(input)).toBeNull();
    },
  );

  test('rejects control characters inside the code', () => {
    expect(parseLabel('CL1-红\t色-36')).toBeNull();
  });

  test('accepts input exactly at the length limit', () => {
    const suffix = '-红-36';
    const raw = `${'C'.repeat(MAX_RAW_LENGTH - suffix.length)}${suffix}`;
    expect(parseLabel(raw)?.raw).toBe(raw);
  });

  test('rejects input over the length limit', () => {
    expect(parseLabel(`${'C'.repeat(MAX_RAW_LENGTH)}-红-36`)).toBeNull();
  });
});
