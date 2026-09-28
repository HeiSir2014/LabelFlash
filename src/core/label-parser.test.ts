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

  test('splits purely numeric trailing segments the same way, right to left', () => {
    // Documents the intentional greedy-code behavior: with 4 hyphen-separated
    // segments, only the last two are treated as color/size, however they look.
    expect(parseLabel('CL1-红-36-37')).toEqual({ raw: 'CL1-红-36-37', code: 'CL1-红', color: '36', size: '37' });
  });

  test('trims whitespace and line endings sent by scanners', () => {
    expect(parseLabel('  CL1-黑-40\r\n')?.raw).toBe('CL1-黑-40');
  });

  test('trims internal whitespace around each field but keeps raw untouched', () => {
    expect(parseLabel('CL1- 红 -36')).toEqual({ raw: 'CL1- 红 -36', code: 'CL1', color: '红', size: '36' });
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

  // Built from code points (not literal escapes) so these invisible characters
  // can't silently get lost or mangled in the source file itself.
  const INVISIBLE_CHARACTERS = [
    String.fromCodePoint(0x0080), // C1 control
    String.fromCodePoint(0x200b), // zero-width space
    String.fromCodePoint(0x2028), // line separator
    String.fromCodePoint(0xfeff), // BOM / zero-width no-break space
  ];

  test.each(INVISIBLE_CHARACTERS.map((char) => `CL1-红${char}-36`))('rejects invisible characters like %p', (input) => {
    expect(parseLabel(input)).toBeNull();
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
