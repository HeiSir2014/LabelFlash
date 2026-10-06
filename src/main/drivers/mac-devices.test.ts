import { describe, expect, test } from 'bun:test';
import { macDevicesWithoutQueue, parseLpstatDevices, parseSystemProfilerUsb } from './mac-devices';

/** 两种写法都要认：较早的 SPUSBDataType 和较新系统的 SPUSBHostDataType（字段名不同）。 */
const PROFILER = JSON.stringify({
  SPUSBDataType: [
    {
      _name: 'USB31Bus',
      _items: [
        {
          _name: '示例 X1',
          vendor_id: '0x1234  (示例品牌)',
          product_id: '0xabcd',
          serial_num: 'SN0001',
          location_id: '0x01100000 / 1',
        },
        { _name: 'USB Keyboard', vendor_id: '0x05ac  (Apple Inc.)', product_id: '0x0250' },
      ],
    },
  ],
  SPUSBHostDataType: [
    { _name: 'USB', _items: [{ _name: '示例 X2', USBDeviceKeyVendorID: '0x1234', USBDeviceKeyProductID: '0xabce' }] },
  ],
});

describe('parseSystemProfilerUsb', () => {
  test('walks the device tree in both formats', () => {
    expect(parseSystemProfilerUsb(PROFILER)).toEqual([
      { name: '示例 X1', serial: 'SN0001', location: '0x01100000 / 1', usbId: { vendorId: 0x1234, productId: 0xabcd } },
      { name: 'USB Keyboard', serial: null, location: null, usbId: { vendorId: 0x05ac, productId: 0x0250 } },
      { name: '示例 X2', serial: null, location: null, usbId: { vendorId: 0x1234, productId: 0xabce } },
    ]);
  });
});

describe('parseLpstatDevices', () => {
  test('reads USB queues with their model and serial', () => {
    const output = [
      'device for Office: ipp://192.168.1.20/ipp/print',
      'device for Label_X1: usb://Example/X1%20Label?serial=SN0001',
    ].join('\n');
    expect(parseLpstatDevices(output)).toEqual([{ queue: 'Label_X1', model: 'X1 Label', serial: 'SN0001' }]);
  });
});

describe('macDevicesWithoutQueue', () => {
  const devices = parseSystemProfilerUsb(PROFILER);
  const known = (id: { vendorId: number }) => id.vendorId === 0x1234;

  test('lists catalog devices that have no CUPS queue yet', () => {
    expect(macDevicesWithoutQueue(devices, [], known).map((device) => device.name)).toEqual(['示例 X1', '示例 X2']);
  });

  test('matches a queue by serial number or by model name', () => {
    const queues = [
      { queue: 'Label_X1', model: 'Whatever', serial: 'SN0001' },
      { queue: 'Label_X2', model: '示例  x2', serial: null },
    ];
    expect(macDevicesWithoutQueue(devices, queues, known)).toEqual([]);
  });
});
