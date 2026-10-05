import { readIppAttributes } from './driver-paper';
import type { PrinterProbeHost } from './printer-probe-host';

const IPP_MAKE_AND_MODEL_PATTERN = /printer-make-and-model \((?:textWithoutLanguage|text)\) = (.+)/;

/** 探测进程回答的驱动名；空的、查不到为 null。 */
export function parseDriverName(output: string | null): string | null {
  const text = output?.trim() ?? '';
  return text === '' ? null : text;
}

/** macOS：ipptool 输出里的 printer-make-and-model（CUPS 队列用的驱动的名字）。 */
export function parseIppMakeAndModel(output: string): string | null {
  return parseDriverName(IPP_MAKE_AND_MODEL_PATTERN.exec(output)?.[1] ?? null);
}

/**
 * 认指令集用的驱动名（DriverHints.modelForDriverName、command-set.ts 的 guessFromDriverName 都按它查）。
 * Windows 经常驻探测进程（host 为 null 时读不到）；macOS 用 ipptool；其他平台读不到。
 * USB 编号这一期不读（5c 读 PnP 设备时另外处理，接在 DriverHints 里，不经过这个函数）。调用方保证打印机在系统列表里。
 */
export async function queryDriverName(printerName: string, host: PrinterProbeHost | null): Promise<string | null> {
  switch (process.platform) {
    case 'win32':
      return parseDriverName(host === null ? null : await host.query('driver', printerName));
    case 'darwin': {
      const output = await readIppAttributes(printerName);
      return output === null ? null : parseIppMakeAndModel(output);
    }
    default:
      return null;
  }
}
