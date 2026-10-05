import { describe, expect, test } from 'bun:test';
import { type PnpRecord, parsePnpRecords, windowsDriverlessDevices } from './windows-devices';

const PRINTER_CLASS = ['USB\\Class_07&SubClass_01&Prot_02', 'USB\\Class_07&SubClass_01', 'USB\\Class_07'];

function record(overrides: Partial<PnpRecord>): PnpRecord {
  return {
    instanceId: 'USB\\VID_1234&PID_ABCD\\SN0001',
    name: '未知设备',
    pnpClass: '',
    problemCode: 28,
    compatibleIds: PRINTER_CLASS,
    parentId: '',
    ...overrides,
  };
}

describe('parsePnpRecords', () => {
  test('reads an empty answer, one object or an array', () => {
    expect(parsePnpRecords('')).toEqual([]);
    expect(parsePnpRecords('[]')).toEqual([]);
    expect(parsePnpRecords(JSON.stringify(record({})))).toEqual([record({})]);
    expect(
      parsePnpRecords(JSON.stringify([record({}), record({ instanceId: 'USB\\VID_1234&PID_ABCD\\SN0002' })])),
    ).toHaveLength(2);
  });

  test('skips malformed entries and fails loudly on garbage', () => {
    expect(parsePnpRecords(JSON.stringify([{ instanceId: 7 }, record({})]))).toEqual([record({})]);
    expect(() => parsePnpRecords('Get-CimInstance : Access denied')).toThrow();
  });
});

describe('windowsDriverlessDevices', () => {
  test('lists a printer-class USB device without a driver', () => {
    expect(windowsDriverlessDevices([record({})])).toEqual([
      {
        key: expect.stringMatching(/^usb-1234-abcd-[0-9a-f]{8}$/),
        usbId: { vendorId: 0x1234, productId: 0xabcd },
        name: '未知设备',
        problem: 'no-driver',
        problemCode: 28,
        isPrinterClass: true,
      },
    ]);
  });

  test('merges the USB device and its USB printing child into one device named after the child', () => {
    const devices = windowsDriverlessDevices([
      record({ problemCode: 10 }),
      record({
        instanceId: 'USBPRINT\\EXAMPLEX1\\7&2A&0&USB001',
        name: '示例 X1',
        pnpClass: 'Printer',
        compatibleIds: [],
        parentId: 'USB\\VID_1234&PID_ABCD\\SN0001',
      }),
    ]);
    expect(devices).toEqual([expect.objectContaining({ name: '示例 X1', problem: 'no-driver', isPrinterClass: true })]);
  });

  test('keeps devices of a vendor-specific class for the catalog to recognise', () => {
    expect(
      windowsDriverlessDevices([record({ compatibleIds: ['USB\\Class_FF&SubClass_00', 'USB\\Class_FF'] })]),
    ).toEqual([expect.objectContaining({ isPrinterClass: false })]);
  });

  test('reports a driver that does not start, and ignores disabled devices', () => {
    expect(windowsDriverlessDevices([record({ problemCode: 10 })])).toEqual([
      expect.objectContaining({ problem: 'driver-error', problemCode: 10 }),
    ]);
    expect(windowsDriverlessDevices([record({ problemCode: 22 })])).toEqual([]);
  });

  test('reads one interface of a composite device', () => {
    expect(windowsDriverlessDevices([record({ instanceId: 'USB\\VID_1234&PID_ABCD&MI_00\\7&1&0&0000' })])).toEqual([
      expect.objectContaining({ usbId: { vendorId: 0x1234, productId: 0xabcd } }),
    ]);
  });
});
