import { expect, test } from 'bun:test';
import { DEVICE_KEY_PATTERN, deviceKey } from './detected-device';

test('gives the same device the same key and different devices different keys', () => {
  const id = { vendorId: 0x1234, productId: 0xabcd };
  const first = deviceKey(id, 'USB\\VID_1234&PID_ABCD\\SN0001');
  expect(first).toMatch(DEVICE_KEY_PATTERN);
  expect(first.startsWith('usb-1234-abcd-')).toBe(true);
  expect(deviceKey(id, 'usb\\vid_1234&pid_abcd\\sn0001')).toBe(first);
  expect(deviceKey(id, 'USB\\VID_1234&PID_ABCD\\SN0002')).not.toBe(first);
});
