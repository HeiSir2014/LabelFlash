import type {
  ActionResult,
  DiagnosisPlatform,
  PrinterFacts,
  QueueFacts,
  SpoolerFacts,
  UsbFacts,
} from '../../core/diagnosis/diagnosis-model';
import type { PaperSize } from '../../shared/paper-sizes';

/**
 * 诊断要问系统的事和能做的修复；Windows、macOS、假打印机各一份实现。
 * 打印机名在交进来之前已经由 DiagnosisStation 核对过在系统列表里。
 */
export interface DiagnosisSystem {
  readonly platform: DiagnosisPlatform;
  /** printerName 为 null 时只看服务本身（macOS 不看这台打印机在 CUPS 里的状态）。 */
  spooler(printerName: string | null): Promise<SpoolerFacts>;
  printer(printerName: string): Promise<PrinterFacts>;
  usb(printerName: string): Promise<UsbFacts>;
  jobs(printerName: string): Promise<QueueFacts>;
  restartSpooler(): Promise<ActionResult>;
  /** macOS：启用 + 接收任务；admin 为 false 时以当前用户做，被拒返回 needs-admin。 */
  enablePrinter(printerName: string, admin: boolean): Promise<ActionResult>;
  /** Windows：打开系统的打印队列窗口，关掉后才完成。 */
  openQueue(printerName: string): Promise<ActionResult>;
  cancelJobs(printerName: string, ids: readonly number[]): Promise<ActionResult>;
  cancelAllJobs(printerName: string): Promise<ActionResult>;
  setDriverPaper(printerName: string, target: PaperSize, admin: boolean): Promise<ActionResult>;
}

export function diagnosisPlatformOf(platform: NodeJS.Platform): DiagnosisPlatform {
  switch (platform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'mac';
    default:
      return 'other';
  }
}

const UNSUPPORTED: ActionResult = { kind: 'failed', detail: '这个系统不支持' };
const UNKNOWN = { kind: 'unknown', reason: 'diagnosis is not supported on this platform' } as const;

/** 其他系统：每项都查不到；修复按管理员策略本来就不会给按钮，这里只兜底。 */
export class UnsupportedDiagnosis implements DiagnosisSystem {
  readonly platform = 'other' as const;
  async spooler(): Promise<SpoolerFacts> {
    return UNKNOWN;
  }
  async printer(): Promise<PrinterFacts> {
    return UNKNOWN;
  }
  async usb(): Promise<UsbFacts> {
    return UNKNOWN;
  }
  async jobs(): Promise<QueueFacts> {
    return UNKNOWN;
  }
  async restartSpooler(): Promise<ActionResult> {
    return UNSUPPORTED;
  }
  async enablePrinter(): Promise<ActionResult> {
    return UNSUPPORTED;
  }
  async openQueue(): Promise<ActionResult> {
    return UNSUPPORTED;
  }
  async cancelJobs(): Promise<ActionResult> {
    return UNSUPPORTED;
  }
  async cancelAllJobs(): Promise<ActionResult> {
    return UNSUPPORTED;
  }
  async setDriverPaper(): Promise<ActionResult> {
    return UNSUPPORTED;
  }
}
