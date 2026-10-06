import type { UsbId } from './usb-id';

/** no-driver：没装驱动；driver-error：装了但起不来或要重装；no-queue：macOS 上没有对应的打印队列。 */
export type DeviceProblem = 'no-driver' | 'driver-error' | 'no-queue';

/** 检测到的、还没有可用驱动的 USB 设备。 */
export interface DetectedDevice {
  /** 稳定的编号（界面按它点「安装」）：usb-<厂商号>-<产品号>-<实例路径的摘要>。 */
  key: string;
  usbId: UsbId;
  /** 系统给的名字（可能只是「未知设备」）。 */
  name: string;
  problem: DeviceProblem;
  /** Windows 设备管理器的问题代码（28 = 没装驱动）；macOS 为 null。 */
  problemCode: number | null;
  /** 系统认得出它是打印设备；不是的只在清单里有它时才列出（免得把 U 盘、扫码枪当成打印机）。 */
  isPrinterClass: boolean;
}

export const DEVICE_KEY_PATTERN = /^usb-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{8}$/;

const HEX_RADIX = 16;
const USB_ID_HEX_DIGITS = 4;
const HASH_HEX_DIGITS = 8;
/** 32 位 FNV-1a（只用来区分同一台电脑上的几台设备，不是安全用途）。 */
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 设备编号：厂商号、产品号加上实例路径（不分大小写）的摘要；同一台设备重新检测编号不变。 */
export function deviceKey(id: UsbId, instancePath: string): string {
  const hex = (value: number) => value.toString(HEX_RADIX).padStart(USB_ID_HEX_DIGITS, '0');
  return `usb-${hex(id.vendorId)}-${hex(id.productId)}-${fnv1a(instancePath.toUpperCase())}`;
}

function fnv1a(text: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(HEX_RADIX).padStart(HASH_HEX_DIGITS, '0');
}
