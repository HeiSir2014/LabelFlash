/** USB 设备的厂商号（VID）和产品号（PID），各 16 位。驱动清单按它认型号。 */
export interface UsbId {
  vendorId: number;
  productId: number;
}

/** 厂商号、产品号写成 4 位十六进制（USB 规范里各 16 位）。 */
const USB_ID_HEX_DIGITS = 4;
const HEX_RADIX = 16;
const HEX_ID_PATTERN = /^[0-9A-F]{4}$/i;
/**
 * Windows 设备实例路径：USB\VID_xxxx&PID_xxxx\序列号；复合设备的一个接口是 USB\VID_xxxx&PID_xxxx&MI_00\…。
 * 只认开头这一段，接口号、序列号不影响型号。
 */
const WINDOWS_USB_INSTANCE_PATTERN = /^USB\\VID_([0-9A-F]{4})&PID_([0-9A-F]{4})(?=[&\\]|$)/i;

/** 两段 4 位十六进制 → UsbId；格式不对返回 null。 */
export function parseHexUsbId(vendor: string, product: string): UsbId | null {
  if (!HEX_ID_PATTERN.test(vendor) || !HEX_ID_PATTERN.test(product)) {
    return null;
  }
  return { vendorId: Number.parseInt(vendor, HEX_RADIX), productId: Number.parseInt(product, HEX_RADIX) };
}

/** 从 Windows 的设备实例路径里取厂商号和产品号；不是 USB 设备的路径返回 null。 */
export function parseWindowsUsbInstanceId(instanceId: string): UsbId | null {
  const match = WINDOWS_USB_INSTANCE_PATTERN.exec(instanceId);
  if (!match) {
    return null;
  }
  const [, vendor = '', product = ''] = match;
  return parseHexUsbId(vendor, product);
}

/** 界面和日志里的写法：0A5F:0120（和设备管理器里一样大写）。 */
export function formatUsbId(id: UsbId): string {
  return `${hex(id.vendorId)}:${hex(id.productId)}`;
}

export function isSameUsbId(a: UsbId, b: UsbId): boolean {
  return a.vendorId === b.vendorId && a.productId === b.productId;
}

function hex(value: number): string {
  return value.toString(HEX_RADIX).toUpperCase().padStart(USB_ID_HEX_DIGITS, '0');
}
