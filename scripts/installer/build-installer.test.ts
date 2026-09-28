import { describe, expect, test } from 'bun:test';
import { parsePublishMode } from './build-installer';

describe('parsePublishMode', () => {
  test('accepts the two modes the package scripts use', () => {
    expect(parsePublishMode(['--publish', 'never'])).toBe('never');
    expect(parsePublishMode(['--publish', 'always'])).toBe('always');
  });

  test('fails fast instead of guessing, so a release build never skips publishing silently', () => {
    expect(() => parsePublishMode([])).toThrow('--publish never|always');
    expect(() => parsePublishMode(['--publish', 'onTag'])).toThrow('onTag');
  });
});
