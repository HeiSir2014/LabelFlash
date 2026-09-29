import { describe, expect, test } from 'bun:test';
import { formatAppVersion } from './app-version';

describe('formatAppVersion', () => {
  test('shows the CI build number after the version', () => {
    expect(formatAppVersion('1.0.2', '123')).toBe('v1.0.2（构建 123）');
  });

  test('shows only the version for a local build', () => {
    expect(formatAppVersion('1.0.2', null)).toBe('v1.0.2');
  });
});
