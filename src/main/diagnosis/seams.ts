import type { ActionResult, CommandSetName } from '../../core/diagnosis/diagnosis-model';

/**
 * 5a（标签机指令）给诊断用的能力。只在 index.ts 里接到 5a 的实现；5a 的名字变了只改那几行。
 * 指令是单向的（设计 7.1）：send 的 done 只说明指令进了打印队列。
 */
export interface LabelCommandsSeam {
  /** 这台打印机实际用的指令集（自动识别的结果或操作员选的）；none = 选了「不发指令」或认不出来。 */
  effectiveCommandSet(printerName: string): Promise<CommandSetName | 'none'>;
  send(printerName: string, action: 'feed' | 'calibrate'): Promise<ActionResult>;
}

/** 5c（驱动安装）给诊断用的能力；5c 合并之前在 index.ts 里是 null，「重新安装驱动」不出现。 */
export interface DriverReinstallSeam {
  /** 在线清单里有这台的型号、能下载核对后静默安装。 */
  canReinstall(printerName: string): Promise<boolean>;
  /** 弹一次管理员确认后重装；结果和其他修复一样用 ActionResult 说。 */
  reinstall(printerName: string): Promise<ActionResult>;
}
