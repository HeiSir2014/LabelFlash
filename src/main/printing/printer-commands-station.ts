import type { DriverHints } from '../../core/drivers/driver-hints';
import {
  type CommandSet,
  configFor,
  type PrinterAction,
  type PrinterCommandConfig,
  RAW_COMMAND_MAX_BYTES,
  withPrinterConfig,
} from '../../core/printer-commands/command-model';
import { detectCommandSet, effectiveCommandSet } from '../../core/printer-commands/command-set';
import { buildAction, buildSetup } from '../../core/printer-commands/printer-commands';
import type { NotSentReason, PrinterCommandResult, PrinterCommandsView } from '../../shared/printer-commands';
import { MAX_PRINTER_COMMAND_ENTRIES } from '../../shared/settings';
import { DEFAULT_PRINTER_DPI } from './qr-code';
import { asciiBytes, type RawSender } from './raw-sender';

export interface PrinterCommandsDeps {
  /** 设置里的 printerCommands（每台打印机的指令设置）。 */
  configs(): Readonly<Record<string, PrinterCommandConfig>>;
  saveConfigs(next: Record<string, PrinterCommandConfig>): void;
  /** 驱动名（见 printer-identity.ts 的 queryDriverName / fake-printers.ts 的 driverName）。 */
  driverNameOf(printerName: string): Promise<string | null>;
  /** 驱动报告的分辨率；读不到为 null。 */
  driverDpi(printerName: string): Promise<number | null>;
  /**
   * 按型号认指令集的在线驱动清单（5c 之前是 NO_DRIVER_HINTS）。取值函数：5c 的清单下载完、装好驱动之后
   * 才会有内容，不能在构造时取一次就定住，每次用到都要重新取。
   */
  hints(): DriverHints;
  sender: RawSender;
  /** 系统打印机列表里有这台（安全底线：只发给它们）。 */
  hasPrinter(printerName: string): Promise<boolean>;
  log(message: string): void;
  warn(message: string): void;
}

type Target = { commandSet: CommandSet; dpi: number } | { commandSet: null; reason: NotSentReason };

/**
 * 标签机指令：面板数据、保存并发送设置、四个动作。指令只在操作员点按钮时发一次，打印前不发；
 * 不经 PrintService、不写打印记录（指令不是标签），每次发送写一行日志。5b（诊断）用 run 做「走一张纸」这类检查。
 */
export class PrinterCommands {
  constructor(private readonly deps: PrinterCommandsDeps) {}

  /** 面板要的：保存的设置、「自动」认出的指令集、驱动名和分辨率。 */
  async describe(printerName: string): Promise<PrinterCommandsView> {
    await this.requirePrinter(printerName);
    const [driverName, driverDpi] = await Promise.all([
      this.deps.driverNameOf(printerName),
      this.deps.driverDpi(printerName),
    ]);
    return {
      config: configFor(this.deps.configs(), printerName),
      detected: await detectCommandSet(driverName, this.deps.hints()),
      driverName,
      driverDpi,
    };
  }

  /**
   * 保存这台打印机的设置并发一次。认出了指令集就先按它的范围把关，不合适时不保存、返回原因；
   * 「不发指令」或认不出时照样保存（选择本身要记住），只是不发。
   */
  async apply(printerName: string, config: PrinterCommandConfig): Promise<PrinterCommandResult> {
    await this.requirePrinter(printerName);
    const before = this.deps.configs();
    if (!Object.hasOwn(before, printerName) && Object.keys(before).length >= MAX_PRINTER_COMMAND_ENTRIES) {
      return { status: 'invalid', issue: `最多为 ${MAX_PRINTER_COMMAND_ENTRIES} 台打印机保存指令设置` };
    }
    // target() 会 await 查驱动名、驱动分辨率：这段时间里别的打印机可能已经存盘，
    // 存盘前必须重新读一次 configs()，不能用进入这个方法时的旧快照，否则会覆盖掉那次存盘。
    const target = await this.target(printerName, config);
    if (target.commandSet === null) {
      this.saveConfig(printerName, config);
      return { status: 'not-sent', reason: target.reason };
    }
    const build = buildSetup(target.commandSet, config, target.dpi);
    if (!build.ok) {
      return { status: 'invalid', issue: build.issue };
    }
    this.saveConfig(printerName, config);
    if (build.text === '') {
      return { status: 'not-sent', reason: 'nothing-to-send' };
    }
    return this.send(printerName, target.commandSet, 'setup', build.text);
  }

  /** 存盘前重新读一次最新的设置，和另一台打印机并发 apply() 时不会互相覆盖。 */
  private saveConfig(printerName: string, config: PrinterCommandConfig): void {
    this.deps.saveConfigs(withPrinterConfig(this.deps.configs(), printerName, config));
  }

  /** 按保存的设置（指令集、纸型）执行一个动作。 */
  async run(printerName: string, action: PrinterAction): Promise<PrinterCommandResult> {
    await this.requirePrinter(printerName);
    const config = configFor(this.deps.configs(), printerName);
    const target = await this.target(printerName, config);
    if (target.commandSet === null) {
      return { status: 'not-sent', reason: target.reason };
    }
    const build = buildAction(target.commandSet, action, config);
    if (!build.ok) {
      return { status: 'invalid', issue: build.issue };
    }
    return this.send(printerName, target.commandSet, action, build.text);
  }

  /** IPC 已经核对过一次；这里再核对，因为 5b 等别的调用方也走这里，打印机也可能刚被拔掉。 */
  private async requirePrinter(printerName: string): Promise<void> {
    if (!(await this.deps.hasPrinter(printerName))) {
      throw new Error(`Printer not found: ${printerName}`);
    }
  }

  private async target(printerName: string, config: PrinterCommandConfig): Promise<Target> {
    if (config.commandSet === 'none') {
      return { commandSet: null, reason: 'no-command-set' };
    }
    const detected =
      config.commandSet === 'auto'
        ? await detectCommandSet(await this.deps.driverNameOf(printerName), this.deps.hints())
        : null;
    const commandSet = effectiveCommandSet(config.commandSet, detected);
    if (commandSet === null) {
      return { commandSet: null, reason: 'unknown-command-set' };
    }
    const dpi = config.dpi ?? (await this.deps.driverDpi(printerName)) ?? DEFAULT_PRINTER_DPI;
    return { commandSet, dpi };
  }

  private async send(
    printerName: string,
    commandSet: CommandSet,
    what: string,
    text: string,
  ): Promise<PrinterCommandResult> {
    const data = asciiBytes(text);
    if (data.length > RAW_COMMAND_MAX_BYTES) {
      throw new Error(`Generated ${what} for ${commandSet} is ${data.length} bytes, over ${RAW_COMMAND_MAX_BYTES}`);
    }
    const result = await this.deps.sender.send(printerName, data);
    if (!result.ok) {
      this.deps.warn(
        `[printer-commands] ${what} (${commandSet}) to "${printerName}" failed: ${result.failure.kind} ${result.failure.detail}`,
      );
      return { status: 'failed', reason: result.failure.kind, detail: result.failure.detail };
    }
    this.deps.log(`[printer-commands] sent ${what} (${commandSet}, ${data.length} bytes) to "${printerName}"`);
    return { status: 'sent', commandSet };
  }
}
