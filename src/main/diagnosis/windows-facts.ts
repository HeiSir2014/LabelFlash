import {
  DIAGNOSIS_LIMITS,
  type JobFlag,
  type PrinterFacts,
  type QueueFacts,
  type QueueJob,
  type SpoolerFacts,
  type UsbFacts,
} from '../../core/diagnosis/diagnosis-model';
import {
  PRINT_TICKET_LOCAL_NAME_PATTERN,
  PRINT_TICKET_NAMESPACE_PATTERN,
  type PrintTicketPaperOption,
  type PrintTicketPaperOptions,
} from '../../core/diagnosis/paper-choice';
import { isRecord } from '../../shared/settings';
import { parsePrinterStatus } from '../printing/printer-status';

/**
 * Windows 探测进程的诊断回答（printer-probe-host.ts 的 spooler / printer / usb / jobs / paper-options）→ 事实。
 * 回答不可信：逐字段核对类型，文字截断，不认识的值按「其他」或丢掉；整体读不懂就是「查不到」，原因写进 reason。
 */

type JsonObject = Record<string, unknown>;
type Read = { ok: true; value: JsonObject } | { ok: false; reason: string };

/** 系统 USB 打印端口的名字：USB001、USB002…… */
const USB_PORT_PATTERN = /^USB\d+$/i;
/** 驱动报告的纸张尺寸上限（微米）：10 米，再大是坏数据。 */
const MAX_PAPER_MICRONS = 10_000_000;
/** 写进 reason 的原文长度。 */
const REASON_SAMPLE_LENGTH = 80;

const SERVICE_STATES: ReadonlyMap<string, Extract<SpoolerFacts, { kind: 'windows' }>['state']> = new Map([
  ['Running', 'running'],
  ['Stopped', 'stopped'],
  ['StartPending', 'pending'],
  ['StopPending', 'pending'],
  ['ContinuePending', 'pending'],
  ['PausePending', 'pending'],
]);

const START_TYPES: ReadonlyMap<string, Extract<SpoolerFacts, { kind: 'windows' }>['startType']> = new Map([
  ['Automatic', 'automatic'],
  ['Manual', 'manual'],
  ['Disabled', 'disabled'],
]);

/** Get-PrintJob 的 JobStatus（[Flags] 枚举，ToString 后是「Error, Printing」这样）里我们关心的几种。 */
const JOB_FLAGS: ReadonlyMap<string, JobFlag> = new Map([
  ['Error', 'error'],
  ['Paused', 'paused'],
  ['Offline', 'offline'],
  ['PaperOut', 'paper-out'],
  ['Blocked', 'blocked'],
  ['UserIntervention', 'user-intervention'],
  ['Printing', 'printing'],
]);

function readObject(reply: string | null): Read {
  if (reply === null) {
    return { ok: false, reason: 'probe query failed or timed out' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply);
  } catch {
    return { ok: false, reason: `not JSON: ${reply.slice(0, REASON_SAMPLE_LENGTH)}` };
  }
  return isRecord(parsed) ? { ok: true, value: parsed } : { ok: false, reason: 'not a JSON object' };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, DIAGNOSIS_LIMITS.textLength) : '';
}

function list(value: unknown, limit: number): JsonObject[] {
  return Array.isArray(value) ? value.slice(0, limit).filter(isRecord) : [];
}

export function parseSpoolerReply(reply: string | null): SpoolerFacts {
  const read = readObject(reply);
  if (!read.ok) {
    return { kind: 'unknown', reason: read.reason };
  }
  return {
    kind: 'windows',
    state: SERVICE_STATES.get(text(read.value['status'])) ?? 'other',
    startType: START_TYPES.get(text(read.value['startType'])) ?? 'other',
  };
}

export function parsePrinterReply(reply: string | null): PrinterFacts {
  const read = readObject(reply);
  if (!read.ok) {
    return { kind: 'unknown', reason: read.reason };
  }
  const status = text(read.value['status']);
  const driverName = text(read.value['driverName']);
  return {
    kind: 'known',
    readiness: parsePrinterStatus(status),
    paused: status.split(/[\s,]+/).includes('Paused'),
    driverName: driverName === '' ? null : driverName,
  };
}

/**
 * USB 打印设备的实例 ID 以「&端口名」结尾（USBPRINT\型号\7&2A1B3C4D&0&USB001）。
 * 同一端口可能留着旧设备的记录：先取现在在的那一个。
 */
export function parseUsbReply(reply: string | null): UsbFacts {
  const read = readObject(reply);
  if (!read.ok) {
    return { kind: 'unknown', reason: read.reason };
  }
  const port = text(read.value['port']);
  if (!USB_PORT_PATTERN.test(port)) {
    return { kind: 'not-usb', port };
  }
  const suffix = `&${port}`.toUpperCase();
  const matches = list(read.value['devices'], DIAGNOSIS_LIMITS.usbDevices).filter((device) =>
    text(device['instanceId']).toUpperCase().endsWith(suffix),
  );
  const device = matches.find((item) => item['present'] === true) ?? matches[0];
  if (device === undefined) {
    return { kind: 'not-found', port };
  }
  const deviceName = text(device['name']) || port;
  const problem = device['problem'];
  const code = typeof problem === 'number' && Number.isInteger(problem) ? problem : 0;
  if (device['present'] !== true) {
    return { kind: 'disconnected', deviceName };
  }
  return code === 0 ? { kind: 'present', deviceName } : { kind: 'problem', deviceName, code };
}

function readJob(entry: JsonObject): QueueJob | null {
  const id = entry['id'];
  // 探测进程把 SubmittedTime 转成带偏移量的 ISO 字符串（`yyyy-MM-ddTHH:mm:sszzz`），不是在 PowerShell
  // 里先转成 Unix 毫秒：偏移量跟着字符串一起传过来，这里按偏移量解析，不会把本地时间当成 UTC 直接读。
  const submittedAt = entry['submittedAt'];
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
    return null;
  }
  if (typeof submittedAt !== 'string') {
    return null;
  }
  const submittedAtMs = Date.parse(submittedAt);
  if (!Number.isFinite(submittedAtMs)) {
    return null;
  }
  const flags = text(entry['status'])
    .split(/[\s,]+/)
    .flatMap((name) => {
      const flag = JOB_FLAGS.get(name);
      return flag === undefined ? [] : [flag];
    });
  return { id, document: text(entry['document']), user: text(entry['user']), submittedAtMs, flags };
}

export function parseJobsReply(reply: string | null): QueueFacts {
  const read = readObject(reply);
  if (!read.ok) {
    return { kind: 'unknown', reason: read.reason };
  }
  const jobs = list(read.value['jobs'], DIAGNOSIS_LIMITS.jobs).flatMap((entry) => {
    const job = readJob(entry);
    return job === null ? [] : [job];
  });
  const total = read.value['total'];
  return {
    kind: 'listed',
    currentUser: text(read.value['user']),
    total: typeof total === 'number' && Number.isSafeInteger(total) && total >= jobs.length ? total : jobs.length,
    jobs,
  };
}

function microns(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_PAPER_MICRONS ? value : null;
}

/** 驱动的纸张选项；名字不是合法 XML 名、命名空间带奇怪字符的丢掉（它们要写进 PrintTicket）。读不懂整体返回 null。 */
export function parsePaperOptionsReply(reply: string | null): PrintTicketPaperOptions | null {
  const read = readObject(reply);
  if (!read.ok) {
    return null;
  }
  const options = list(read.value['options'], DIAGNOSIS_LIMITS.paperOptions).flatMap(
    (entry): PrintTicketPaperOption[] => {
      const namespace = entry['namespace'];
      const localName = entry['localName'];
      if (
        typeof namespace !== 'string' ||
        !PRINT_TICKET_NAMESPACE_PATTERN.test(namespace) ||
        typeof localName !== 'string' ||
        !PRINT_TICKET_LOCAL_NAME_PATTERN.test(localName)
      ) {
        return [];
      }
      return [{ namespace, localName, widthMicrons: microns(entry['width']), heightMicrons: microns(entry['height']) }];
    },
  );
  return { options, supportsCustom: read.value['custom'] === true };
}
