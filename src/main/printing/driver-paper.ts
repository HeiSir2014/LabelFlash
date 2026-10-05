import { execFile } from 'node:child_process';
import type { DriverPaper } from '../../shared/driver-paper';
import type { PrinterProbeHost } from './printer-probe-host';

/** ipptool 要连 CUPS 取全部属性，给足时间；诊断的 Get-Jobs 也用它。 */
export const IPP_PROBE_TIMEOUT_MS = 8_000;
/** ipptool 会返回打印机的全部属性（通常十几 KB），留足余量。 */
const PROBE_MAX_BUFFER_BYTES = 4 * 1024 * 1024;

/** Windows：Win32_PrinterConfiguration 的纸张宽高以 0.1mm 为单位（查询脚本见 printer-probe-host.ts）。 */
const CIM_UNITS_PER_MM = 10;

/** macOS：CUPS 的 media-col-default 以 0.01mm 为单位（PWG 5100.3）。 */
const IPP_UNITS_PER_MM = 100;
const IPP_MEDIA_SIZE_PATTERN =
  /media-col-default \(collection\) = .*?media-size=\{x-dimension=(\d+) y-dimension=(\d+)\}/;
const IPP_RESOLUTION_PATTERN = /printer-resolution-default \(resolution\) = (\d+)(?:x\d+)?dpi/;
/** macOS 自带的 CUPS 测试文件：请求打印机的全部属性。 */
const IPP_ATTRIBUTES_TEST = 'get-printer-attributes.test';
const MAC_PRINTERS_SETTINGS_URL = 'x-apple.systempreferences:com.apple.Print-Scan-Settings.extension';

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** 解析 Windows PowerShell 输出的 JSON；没有这台打印机或驱动没有报告纸张时返回 null。 */
export function parseCimPaper(output: string): DriverPaper | null {
  const text = output.trim();
  if (text === '') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const width = positiveNumber(record['PaperWidth']);
  const length = positiveNumber(record['PaperLength']);
  if (width === null || length === null) {
    return null;
  }
  return {
    widthMm: width / CIM_UNITS_PER_MM,
    heightMm: length / CIM_UNITS_PER_MM,
    dpi: positiveNumber(record['HorizontalResolution']),
  };
}

/** 解析 macOS `ipptool -tv … get-printer-attributes.test` 的输出。 */
export function parseIppPaper(output: string): DriverPaper | null {
  const size = IPP_MEDIA_SIZE_PATTERN.exec(output);
  const width = positiveNumber(Number(size?.[1]));
  const length = positiveNumber(Number(size?.[2]));
  if (width === null || length === null) {
    return null;
  }
  const resolution = IPP_RESOLUTION_PATTERN.exec(output);
  return {
    widthMm: width / IPP_UNITS_PER_MM,
    heightMm: length / IPP_UNITS_PER_MM,
    dpi: positiveNumber(Number(resolution?.[1])),
  };
}

/** CUPS 本机队列地址；队列名做 URL 编码，参数按数组传给 ipptool，不经过 shell。 */
export function cupsPrinterUri(printerName: string): string {
  return `ipp://localhost/printers/${encodeURIComponent(printerName)}`;
}

/** 用 ipptool 取这台打印机的全部属性（文字输出）；失败返回 null 并写日志。纸张、驱动名都从这里解析。 */
export function readIppAttributes(printerName: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      '/usr/bin/ipptool',
      ['-tv', cupsPrinterUri(printerName), IPP_ATTRIBUTES_TEST],
      { timeout: IPP_PROBE_TIMEOUT_MS, maxBuffer: PROBE_MAX_BUFFER_BYTES },
      (error, stdout) => {
        if (error) {
          console.warn(`[driver-paper] ipptool failed for "${printerName}": ${error.message}`);
          resolve(null);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

async function queryIppPaper(printerName: string): Promise<DriverPaper | null> {
  const output = await readIppAttributes(printerName);
  return output === null ? null : parseIppPaper(output);
}

/**
 * 读取驱动默认纸张；不支持的平台或查询失败返回 null（未知）。
 * Windows 经常驻探测进程查询（host 为 null 时按未知处理），macOS 用 ipptool。
 */
export async function queryDriverPaper(
  printerName: string,
  host: PrinterProbeHost | null,
): Promise<DriverPaper | null> {
  switch (process.platform) {
    case 'win32': {
      const output = host ? await host.query('paper', printerName) : null;
      return output === null ? null : parseCimPaper(output);
    }
    case 'darwin':
      return queryIppPaper(printerName);
    default:
      return null;
  }
}

/**
 * 打开这台打印机的设置，让操作员把默认纸张改成它负责的纸。参数按数组传入，不经过 shell。
 * - Windows：驱动自己的「打印首选项」窗口，关闭后 Promise 才完成，调用方据此重新检测。
 * - macOS：系统设置的「打印机与扫描仪」，打开后立即完成（回到程序时按窗口焦点重新检测）。
 */
export function openPrinterPreferences(printerName: string): Promise<void> {
  switch (process.platform) {
    case 'win32':
      return runCommand('rundll32.exe', ['printui.dll,PrintUIEntry', '/e', '/n', printerName]);
    case 'darwin':
      return runCommand('/usr/bin/open', [MAC_PRINTERS_SETTINGS_URL]);
    default:
      return Promise.reject(new Error(`Printer settings are not supported on ${process.platform}`));
  }
}

function runCommand(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
