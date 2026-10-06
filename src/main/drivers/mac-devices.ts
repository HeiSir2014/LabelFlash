import { type DetectedDevice, deviceKey } from '../../core/drivers/detected-device';
import type { UsbId } from '../../core/drivers/usb-id';
import { runFile } from './run-command';

export interface MacUsbDevice {
  name: string;
  serial: string | null;
  location: string | null;
  usbId: UsbId;
}

/** CUPS 里的 USB 队列：usb://厂家/型号?serial=序列号。 */
export interface CupsUsbQueue {
  queue: string;
  model: string;
  serial: string | null;
}

const PROFILER_TIMEOUT_MS = 20_000;
const LPSTAT_TIMEOUT_MS = 10_000;
/** system_profiler 和 lpstat 的输出随系统语言变，固定成英文再解析。 */
const C_LOCALE_ENV = { ...process.env, LC_ALL: 'C', LANG: 'C' };
const HEX_ID_PATTERN = /^0x([0-9a-f]{1,4})\b/i;
const HEX_RADIX = 16;
/** USB 厂商号、产品号各 16 位。 */
const MAX_USB_ID = 0xffff;
const MAX_STDERR_LOG_LENGTH = 500;
const LPSTAT_USB_LINE = /^device for (.+?): (usb:\/\/\S+)$/;

/**
 * 解析 `system_profiler -json SPUSBDataType SPUSBHostDataType`：递归走设备树，有厂商号和产品号的就是设备。
 * 较早的系统用 vendor_id / product_id / serial_num，较新的用 USBDeviceKey* 字段，两种都认。
 */
export function parseSystemProfilerUsb(output: string): MacUsbDevice[] {
  const devices: MacUsbDevice[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }
    if (typeof node !== 'object' || node === null) {
      return;
    }
    const record = node as Record<string, unknown>;
    const vendorId = hexId(record['vendor_id'] ?? record['USBDeviceKeyVendorID']);
    const productId = hexId(record['product_id'] ?? record['USBDeviceKeyProductID']);
    if (vendorId !== null && productId !== null) {
      devices.push({
        name: stringOr(record['_name'], ''),
        serial: stringOrNull(record['serial_num'] ?? record['USBDeviceKeySerialNumber']),
        location: stringOrNull(record['location_id'] ?? record['USBDeviceKeyLocationID']),
        usbId: { vendorId, productId },
      });
    }
    for (const value of Object.values(record)) {
      if (typeof value === 'object') {
        visit(value);
      }
    }
  };
  visit(JSON.parse(output) as unknown);
  return devices;
}

/** 解析 `lpstat -v`（LC_ALL=C）：只要 usb:// 队列。 */
export function parseLpstatDevices(output: string): CupsUsbQueue[] {
  return output.split('\n').flatMap((line) => {
    const match = LPSTAT_USB_LINE.exec(line.trim());
    if (!match) {
      return [];
    }
    const [, queue = '', uri = ''] = match;
    try {
      const url = new URL(uri);
      return [
        { queue, model: decodeURIComponent(url.pathname.replace(/^\//, '')), serial: url.searchParams.get('serial') },
      ];
    } catch {
      return [];
    }
  });
}

/**
 * macOS 没有「问题代码」：没装驱动的标签机就是没有 CUPS 队列。只看清单里有的型号（认不出别的设备是不是打印机），
 * 有序列号的按序列号对，没有的按型号名对（不分大小写、忽略空白）。
 */
export function macDevicesWithoutQueue(
  devices: readonly MacUsbDevice[],
  queues: readonly CupsUsbQueue[],
  isKnown: (id: UsbId) => boolean,
): DetectedDevice[] {
  return devices
    .filter((device) => isKnown(device.usbId))
    .filter(
      (device) =>
        !queues.some((queue) =>
          device.serial !== null && queue.serial !== null
            ? device.serial === queue.serial
            : normalize(device.name) === normalize(queue.model),
        ),
    )
    .map((device) => ({
      key: deviceKey(device.usbId, device.serial ?? device.location ?? device.name),
      usbId: device.usbId,
      name: device.name,
      problem: 'no-queue' as const,
      problemCode: null,
      isPrinterClass: false,
    }));
}

/** 这台 Mac 上清单里有、还没有打印队列的 USB 设备；system_profiler 失败时抛错。lpstat 失败按「没有队列」处理。 */
export async function detectMacDevices(isKnown: (id: UsbId) => boolean): Promise<DetectedDevice[]> {
  const profiler = await runFile('/usr/sbin/system_profiler', ['-json', 'SPUSBDataType', 'SPUSBHostDataType'], {
    timeoutMs: PROFILER_TIMEOUT_MS,
    env: C_LOCALE_ENV,
  });
  if (profiler.exitCode !== 0) {
    throw new Error(
      `system_profiler failed (exit ${profiler.exitCode}): ${profiler.stderr.trim().slice(0, MAX_STDERR_LOG_LENGTH)}`,
    );
  }
  const lpstat = await runFile('/usr/bin/lpstat', ['-v'], { timeoutMs: LPSTAT_TIMEOUT_MS, env: C_LOCALE_ENV });
  return macDevicesWithoutQueue(parseSystemProfilerUsb(profiler.stdout), parseLpstatDevices(lpstat.stdout), isKnown);
}

function hexId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_USB_ID) {
    return value;
  }
  const match = typeof value === 'string' ? HEX_ID_PATTERN.exec(value.trim()) : null;
  return match?.[1] === undefined ? null : Number.parseInt(match[1], HEX_RADIX);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function normalize(name: string): string {
  return name.replace(/\s+/g, '').toLowerCase();
}
