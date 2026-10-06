import { describe, expect, test } from 'bun:test';
import { formatUsbId, isSameUsbId, parseHexUsbId, parseWindowsUsbInstanceId } from './usb-id';

describe('parseWindowsUsbInstanceId', () => {
  test('reads the vendor and product id of a USB device', () => {
    expect(parseWindowsUsbInstanceId('USB\\VID_5678&PID_0120\\ABC123')).toEqual({
      vendorId: 0x5678,
      productId: 0x0120,
    });
  });

  test('reads one interface of a composite device', () => {
    expect(parseWindowsUsbInstanceId('USB\\VID_1234&PID_abcd&MI_00\\7&1A2B3C&0&0000')).toEqual({
      vendorId: 0x1234,
      productId: 0xabcd,
    });
  });

  test('ignores paths that are not USB devices or have malformed ids', () => {
    expect(parseWindowsUsbInstanceId('USBPRINT\\EXAMPLEX1\\7&2&0&USB001')).toBeNull();
    expect(parseWindowsUsbInstanceId('USB\\VID_12&PID_ABCD\\1')).toBeNull();
    expect(parseWindowsUsbInstanceId('USB\\VID_12345&PID_ABCD\\1')).toBeNull();
  });
});

describe('parseHexUsbId', () => {
  test('accepts exactly four hex digits for each part', () => {
    expect(parseHexUsbId('1234', 'ABCD')).toEqual({ vendorId: 0x1234, productId: 0xabcd });
    expect(parseHexUsbId('123', 'ABCD')).toBeNull();
    expect(parseHexUsbId('12G4', 'ABCD')).toBeNull();
  });
});

describe('formatUsbId', () => {
  test('pads and upper-cases like Device Manager', () => {
    expect(formatUsbId({ vendorId: 0x5678, productId: 0x12 })).toBe('5678:0012');
  });

  test('compares both parts', () => {
    expect(isSameUsbId({ vendorId: 1, productId: 2 }, { vendorId: 1, productId: 2 })).toBe(true);
    expect(isSameUsbId({ vendorId: 1, productId: 2 }, { vendorId: 1, productId: 3 })).toBe(false);
  });
});
