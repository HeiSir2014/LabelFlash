import { describe, expect, test } from 'bun:test';
import { isValidSharePassword } from './ipp-sharing';

describe('isValidSharePassword', () => {
  test('takes 4 to 64 characters without control characters', () => {
    expect(isValidSharePassword('1234')).toBe(true);
    expect(isValidSharePassword('前台:打印 2026')).toBe(true);
    expect(isValidSharePassword('123')).toBe(false);
    expect(isValidSharePassword('x'.repeat(65))).toBe(false);
    expect(isValidSharePassword('12\n34')).toBe(false);
    expect(isValidSharePassword(1234)).toBe(false);
  });
});
