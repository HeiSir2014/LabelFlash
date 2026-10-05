import {
  DIAGNOSIS_LIMITS,
  type JobFlag,
  type QueueFacts,
  type QueueJob,
  type UsbFacts,
} from '../../core/diagnosis/diagnosis-model';
import { PRINTER_ISSUES, type PrinterIssue, type PrinterReadiness } from '../../shared/printer-readiness';
import { isRecord } from '../../shared/settings';

/** ipptool -tv 输出的一行属性：「名字 (类型) = 值」。 */
const IPP_ATTRIBUTE_LINE = /^\s*([a-z0-9-]+) \(([^)]*)\) = (.*)$/;
const MS_PER_SECOND = 1_000;
/** system_profiler 的 USB 树最多走这么深、收这么多个设备：真实的树三四层、几十个设备。 */
const MAX_USB_TREE_DEPTH = 12;
const MAX_USB_DEVICES = 200;
const USB_URI_PATTERN = /^usb:\/\/([^/?]*)\/([^?]*)(?:\?(.*))?$/;

function lines(output: string): string[] {
  return output.split(/\r?\n/);
}

/** 每个属性第一次出现的值（打印机属性的回答里每个属性只出现一次）。 */
function ippAttributes(output: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const line of lines(output)) {
    const match = IPP_ATTRIBUTE_LINE.exec(line);
    const name = match?.[1];
    const value = match?.[3];
    if (name !== undefined && value !== undefined && !attributes.has(name)) {
      attributes.set(name, value.trim());
    }
  }
  return attributes;
}

function keywords(value: string | undefined): string[] {
  return value === undefined
    ? []
    : value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '' && item !== 'none');
}

/** lpstat -r：调度程序在不在跑；读不懂（例如没按英文输出）为 null。 */
export function parseSchedulerStatus(output: string | null): boolean | null {
  if (output === null) {
    return null;
  }
  if (/scheduler is not running/.test(output)) {
    return false;
  }
  return /scheduler is running/.test(output) ? true : null;
}

/** 打印机属性里诊断用到的几项。 */
export interface IppPrinterState {
  state: 'idle' | 'processing' | 'stopped' | null;
  reasons: string[];
  acceptingJobs: boolean | null;
  makeAndModel: string | null;
  mediaDefault: string | null;
  mediaSupported: string[];
}

export function parseIppPrinterState(output: string): IppPrinterState {
  const attributes = ippAttributes(output);
  const state = attributes.get('printer-state');
  const accepting = attributes.get('printer-is-accepting-jobs');
  const media = attributes.get('media-default');
  return {
    state: state === 'idle' || state === 'processing' || state === 'stopped' ? state : null,
    reasons: keywords(attributes.get('printer-state-reasons')),
    acceptingJobs: accepting === 'true' ? true : accepting === 'false' ? false : null,
    makeAndModel: attributes.get('printer-make-and-model')?.slice(0, DIAGNOSIS_LIMITS.textLength) ?? null,
    mediaDefault: media === undefined || media === 'none' ? null : media,
    mediaSupported: keywords(attributes.get('media-supported')),
  };
}

interface ReasonStatus {
  detail: string;
  issue: PrinterIssue;
}

/** CUPS 的 printer-state-reasons（去掉 -error / -warning / -report 后缀）里表示「打不了」的几种。paused 在后台打印服务一项说。 */
const REASON_STATUS: ReadonlyMap<string, ReasonStatus> = new Map([
  ['media-empty', { detail: '缺纸', issue: 'paperOut' }],
  ['media-needed', { detail: '缺纸', issue: 'paperOut' }],
  ['input-tray-missing', { detail: '纸盒没装好', issue: 'paperOut' }],
  ['media-jam', { detail: '卡纸', issue: 'paperJam' }],
  ['door-open', { detail: '机盖未关', issue: 'doorOpen' }],
  ['cover-open', { detail: '机盖未关', issue: 'doorOpen' }],
  ['offline', { detail: '打印机离线', issue: 'offline' }],
  // connecting-to-device 不算：CUPS 正在重新连接后端（USB、网络）时常见，是瞬时状态，一般自己就恢复了，
  // 当成故障报的话，正常的重连也会被当成需要处理的问题。
  ['marker-supply-empty', { detail: '碳带或墨粉耗尽', issue: 'other' }],
  ['toner-empty', { detail: '碳带或墨粉耗尽', issue: 'other' }],
]);

/** 和 Windows 的 parsePrinterStatus 同样的规则：同时有几个问题时，按 PRINTER_ISSUES 的顺序取最需要人动手的那个。 */
export function readinessFromReasons(reasons: readonly string[]): PrinterReadiness {
  const problems = reasons.flatMap((reason) => {
    const status = REASON_STATUS.get(reason.replace(/-(error|warning|report)$/, ''));
    return status === undefined ? [] : [status];
  });
  if (problems.length === 0) {
    return { ready: true };
  }
  const issue = PRINTER_ISSUES.find((candidate) => problems.some((status) => status.issue === candidate)) ?? 'other';
  return { ready: false, detail: [...new Set(problems.map((status) => status.detail))].join('、'), issue };
}

/** lpstat -v <队列>：设备地址；读不懂为 null。 */
export function parseDeviceUri(output: string | null): string | null {
  if (output === null) {
    return null;
  }
  const match = /^device for .+?: (\S+)\s*$/m.exec(output);
  return match?.[1] ?? null;
}

/** USB 树里的一个设备（含集线器，不影响按序列号、名字匹配）。 */
export interface UsbDevice {
  name: string;
  serial: string | null;
}

function collectDevices(node: unknown, depth: number, devices: UsbDevice[]): void {
  if (depth > MAX_USB_TREE_DEPTH || devices.length >= MAX_USB_DEVICES) {
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      collectDevices(child, depth + 1, devices);
    }
    return;
  }
  if (!isRecord(node)) {
    return;
  }
  const name = node['_name'];
  const serial = node['serial_num'] ?? node['USBDeviceKeySerialNumber'];
  if (typeof name === 'string' && name !== '') {
    devices.push({
      name: name.slice(0, DIAGNOSIS_LIMITS.textLength),
      serial: typeof serial === 'string' && serial !== '' ? serial : null,
    });
  }
  collectDevices(node['_items'], depth + 1, devices);
}

/** system_profiler -json SPUSBDataType SPUSBHostDataType：两种布局都收（macOS 15 起 USB 信息在后一个里）。 */
export function parseSystemProfilerUsb(output: string | null): UsbDevice[] | null {
  if (output === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  const devices: UsbDevice[] = [];
  collectDevices(parsed['SPUSBDataType'], 0, devices);
  collectDevices(parsed['SPUSBHostDataType'], 0, devices);
  return devices;
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

function normalized(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase();
}

/**
 * CUPS 的 USB 设备地址是 usb://厂家/型号?serial=序列号：有序列号按序列号找，没有按型号名字找。
 * 不是 usb:// 的（dnssd、ipp、socket……）这一项不适用，只显示协议名（地址里可能有局域网 IP，不显示）。
 */
export function macUsbFacts(uri: string | null, devices: readonly UsbDevice[] | null): UsbFacts {
  if (uri === null) {
    return { kind: 'unknown', reason: 'lpstat -v gave no device uri' };
  }
  const scheme = uri.split(':')[0] ?? '';
  const match = USB_URI_PATTERN.exec(uri);
  if (match === null) {
    return scheme === 'usb'
      ? { kind: 'unknown', reason: `unreadable usb uri: ${uri.slice(0, DIAGNOSIS_LIMITS.textLength)}` }
      : { kind: 'not-usb', port: scheme };
  }
  if (devices === null) {
    return { kind: 'unknown', reason: 'system_profiler gave no usb devices' };
  }
  const make = decode(match[1] ?? '');
  const model = decode(match[2] ?? '');
  const serial = new URLSearchParams(match[3] ?? '').get('serial');
  const found =
    serial === null
      ? devices.find(
          (device) =>
            model !== '' &&
            (normalized(device.name).includes(normalized(model)) ||
              normalized(model).includes(normalized(device.name))),
        )
      : devices.find((device) => device.serial === serial);
  return found === undefined
    ? { kind: 'not-found', port: `usb://${make}/${model}` }
    : { kind: 'present', deviceName: found.name };
}

const JOB_ATTRIBUTES: ReadonlySet<string> = new Set([
  'job-id',
  'job-name',
  'job-originating-user-name',
  'job-state',
  'job-state-reasons',
  'time-at-creation',
]);

const JOB_STATE_FLAGS: ReadonlyMap<string, JobFlag> = new Map([
  ['pending-held', 'held'],
  ['processing-stopped', 'stopped'],
  ['processing', 'printing'],
]);

const JOB_REASON_FLAGS: ReadonlyMap<string, JobFlag> = new Map([
  ['printer-stopped', 'stopped'],
  ['job-hold-until-specified', 'held'],
]);

function readIppJob(attributes: ReadonlyMap<string, string>): QueueJob | null {
  const id = Number(attributes.get('job-id'));
  const created = Number(attributes.get('time-at-creation'));
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(created)) {
    return null;
  }
  const flags = new Set<JobFlag>();
  const stateFlag = JOB_STATE_FLAGS.get(attributes.get('job-state') ?? '');
  if (stateFlag !== undefined) {
    flags.add(stateFlag);
  }
  for (const reason of keywords(attributes.get('job-state-reasons'))) {
    const flag = JOB_REASON_FLAGS.get(reason);
    if (flag !== undefined) {
      flags.add(flag);
    }
  }
  return {
    id,
    document: (attributes.get('job-name') ?? '').slice(0, DIAGNOSIS_LIMITS.textLength),
    user: (attributes.get('job-originating-user-name') ?? '').slice(0, DIAGNOSIS_LIMITS.textLength),
    submittedAtMs: created * MS_PER_SECOND,
    flags: [...flags],
  };
}

/** ipptool -tv 的 Get-Jobs 输出：任务一个接一个列出来，某个属性第二次出现就是下一个任务。null = ipptool 没跑成。 */
export function parseIppJobs(output: string | null, currentUser: string): QueueFacts {
  if (output === null) {
    return { kind: 'unknown', reason: 'ipptool Get-Jobs failed' };
  }
  const groups: Map<string, string>[] = [];
  let current: Map<string, string> | null = null;
  for (const line of lines(output)) {
    const match = IPP_ATTRIBUTE_LINE.exec(line);
    const name = match?.[1];
    const value = match?.[3];
    if (name === undefined || value === undefined || !JOB_ATTRIBUTES.has(name)) {
      continue;
    }
    if (current === null || current.has(name)) {
      current = new Map();
      groups.push(current);
    }
    current.set(name, value.trim());
  }
  const jobs = groups.flatMap((group) => {
    const job = readIppJob(group);
    return job === null ? [] : [job];
  });
  return { kind: 'listed', currentUser, total: jobs.length, jobs: jobs.slice(0, DIAGNOSIS_LIMITS.jobs) };
}
