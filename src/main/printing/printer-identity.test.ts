import { describe, expect, test } from 'bun:test';
import { parseDriverName, parseIppMakeAndModel } from './printer-identity';

describe('parseDriverName (Windows)', () => {
  test('trims the driver name and treats an empty answer as unknown', () => {
    expect(parseDriverName(' Label Printer TSPL \r\n')).toBe('Label Printer TSPL');
    expect(parseDriverName('')).toBeNull();
    expect(parseDriverName(null)).toBeNull();
  });
});

describe('parseIppMakeAndModel (macOS)', () => {
  test('reads the make and model CUPS reports', () => {
    const output = [
      '        printer-state (enum) = idle',
      '        printer-make-and-model (textWithoutLanguage) = Label Printer TSPL',
      '        printer-resolution-default (resolution) = 203dpi',
    ].join('\n');
    expect(parseIppMakeAndModel(output)).toBe('Label Printer TSPL');
  });

  test('returns null without the attribute', () => {
    expect(parseIppMakeAndModel('printer-state (enum) = idle')).toBeNull();
  });
});
