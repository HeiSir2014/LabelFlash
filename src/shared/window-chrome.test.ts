import { describe, expect, test } from 'bun:test';
import { windowChromeFor } from './window-chrome';

describe('windowChromeFor', () => {
  test('keeps the native traffic lights on macOS', () => {
    expect(windowChromeFor('darwin')).toBe('mac-traffic-lights');
  });

  test('draws its own window buttons elsewhere', () => {
    expect(windowChromeFor('win32')).toBe('custom-buttons');
    expect(windowChromeFor('linux')).toBe('custom-buttons');
  });
});
