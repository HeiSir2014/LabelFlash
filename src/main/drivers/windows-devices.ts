import { type DetectedDevice, type DeviceProblem, deviceKey } from '../../core/drivers/detected-device';
import { parseWindowsUsbInstanceId } from '../../core/drivers/usb-id';
import { runPowerShell } from './run-command';

/** Win32_PnPEntity 里我们关心的字段（查询脚本输出的形状）。 */
export interface PnpRecord {
  instanceId: string;
  name: string;
  pnpClass: string;
  /** ConfigManagerErrorCode（设备管理器的问题代码，CM_PROB_*）。 */
  problemCode: number;
  compatibleIds: string[];
  /** USBPRINT 子设备的父设备（USB\VID_…）；其他为空。 */
  parentId: string;
}

/** 一次最多看这么多个有问题的 USB 设备：一台电脑接的 USB 设备不会超过几十个，挡住异常的输出量。 */
const MAX_DEVICE_RECORDS = 64;
/** 查询最多等 30 秒：第一次加载 CIM 和 PnpDevice 模块要几秒。 */
const DETECT_TIMEOUT_MS = 30_000;
const MAX_STDERR_LOG_LENGTH = 500;
/** 1 没配置、28 没装驱动；22 是被停用（操作员自己停的，不是驱动问题），不列出。其余是驱动装了但起不来或要重装。 */
const NO_DRIVER_CODES: ReadonlySet<number> = new Set([1, 28]);
const DISABLED_CODE = 22;
/** USB 打印机类（接口类 07），兼容 ID 里写成 USB\Class_07。 */
const PRINTER_CLASS_ID = /^USB\\Class_07(?:&|$)/i;
const USB_PRINT_PREFIX = /^USBPRINT\\/i;

/**
 * 有问题的 USB 设备和 USB 打印子设备（usbprint.sys 为打印机类设备建的 USBPRINT\…）：
 * - CIM 在服务端按问题代码过滤，不拉全部设备；
 * - USBPRINT 子设备本身没有 VID/PID，经 DEVPKEY_Device_Parent 找到 USB 父设备；
 * - 输出一行 JSON（-InputObject 保住数组，空的时候是 [] 或空串）。
 * 不需要管理员权限；只在操作员打开「驱动」一节或点「重新检测」时运行。
 */
export const WINDOWS_DEVICES_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$records = @(
  Get-CimInstance -ClassName Win32_PnPEntity -Filter 'ConfigManagerErrorCode <> 0' |
    Where-Object { $_.PNPDeviceID -like 'USB\VID_*' -or $_.PNPDeviceID -like 'USBPRINT\*' } |
    Select-Object -First ${MAX_DEVICE_RECORDS} |
    ForEach-Object {
      $parent = ''
      if ($_.PNPDeviceID -like 'USBPRINT\*') {
        $property = Get-PnpDeviceProperty -InstanceId $_.PNPDeviceID -KeyName 'DEVPKEY_Device_Parent' -ErrorAction SilentlyContinue
        if ($property) { $parent = [string]$property.Data }
      }
      [pscustomobject]@{
        instanceId = [string]$_.PNPDeviceID
        name = [string]$_.Name
        pnpClass = [string]$_.PNPClass
        problemCode = [int]$_.ConfigManagerErrorCode
        compatibleIds = @($_.CompatibleID | Select-Object -First 16)
        parentId = $parent
      }
    }
)
ConvertTo-Json -InputObject $records -Compress -Depth 3
`;

/** 解析查询输出；不是 JSON 时抛错（查询本身出了问题，交给调用方提示「检测失败」）。 */
export function parsePnpRecords(output: string): PnpRecord[] {
  const text = output.trim();
  if (text === '') {
    return [];
  }
  const parsed: unknown = JSON.parse(text);
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items.flatMap((item) => {
    const record = toRecord(item);
    return record === null ? [] : [record];
  });
}

/**
 * 按 USB 设备归并：USB 设备和它的 USBPRINT 子设备是同一台打印机。名字优先用子设备的（来自打印机自报的型号），
 * 只要有一条是「没装驱动」就算没装驱动；被停用的不列出。
 */
export function windowsDriverlessDevices(records: readonly PnpRecord[]): DetectedDevice[] {
  const groups = new Map<string, PnpRecord[]>();
  for (const record of records) {
    const usbInstance = usbInstanceOf(record);
    if (usbInstance !== null && record.problemCode !== DISABLED_CODE) {
      const key = usbInstance.toUpperCase();
      groups.set(key, [...(groups.get(key) ?? []), record]);
    }
  }
  const devices: DetectedDevice[] = [];
  for (const [instance, group] of groups) {
    const usbId = parseWindowsUsbInstanceId(instance);
    const first = group[0];
    if (usbId === null || first === undefined) {
      continue;
    }
    const child = group.find((record) => USB_PRINT_PREFIX.test(record.instanceId));
    const missing = group.find((record) => NO_DRIVER_CODES.has(record.problemCode));
    const problem: DeviceProblem = missing ? 'no-driver' : 'driver-error';
    devices.push({
      key: deviceKey(usbId, instance),
      usbId,
      name: child?.name || first.name,
      problem,
      problemCode: (missing ?? first).problemCode,
      isPrinterClass: group.some(isPrinterClass),
    });
  }
  return devices.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

/** 查询这台电脑上缺驱动的 USB 设备；查询失败时抛错（带退出码和 stderr 摘要，写日志用）。 */
export async function detectWindowsDevices(): Promise<DetectedDevice[]> {
  const result = await runPowerShell(WINDOWS_DEVICES_SCRIPT, DETECT_TIMEOUT_MS);
  if (result.exitCode !== 0) {
    throw new Error(
      `USB device query failed (exit ${result.exitCode}${result.timedOut ? ', timed out' : ''}): ${result.stderr.trim().slice(0, MAX_STDERR_LOG_LENGTH)}`,
    );
  }
  return windowsDriverlessDevices(parsePnpRecords(result.stdout));
}

function usbInstanceOf(record: PnpRecord): string | null {
  if (parseWindowsUsbInstanceId(record.instanceId) !== null) {
    return record.instanceId;
  }
  return parseWindowsUsbInstanceId(record.parentId) !== null ? record.parentId : null;
}

function isPrinterClass(record: PnpRecord): boolean {
  return (
    record.pnpClass === 'Printer' ||
    USB_PRINT_PREFIX.test(record.instanceId) ||
    record.compatibleIds.some((id) => PRINTER_CLASS_ID.test(id))
  );
}

function toRecord(value: unknown): PnpRecord | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { instanceId, name, pnpClass, problemCode, compatibleIds, parentId } = value as Record<string, unknown>;
  if (typeof instanceId !== 'string' || !Number.isInteger(problemCode)) {
    return null;
  }
  return {
    instanceId,
    name: typeof name === 'string' ? name : '',
    pnpClass: typeof pnpClass === 'string' ? pnpClass : '',
    problemCode: problemCode as number,
    compatibleIds: Array.isArray(compatibleIds)
      ? compatibleIds.filter((id): id is string => typeof id === 'string')
      : [],
    parentId: typeof parentId === 'string' ? parentId : '',
  };
}
