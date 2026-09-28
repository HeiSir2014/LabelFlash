import { describe, expect, test } from 'bun:test';
import { isPermissionGranted } from './permissions';

describe('isPermissionGranted', () => {
  test('lets the page write plain text to the clipboard and nothing else', () => {
    expect(isPermissionGranted('clipboard-sanitized-write')).toBe(true);
    for (const permission of ['clipboard-read', 'media', 'notifications', 'geolocation', 'openExternal']) {
      expect(isPermissionGranted(permission)).toBe(false);
    }
  });
});
