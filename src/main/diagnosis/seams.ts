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

/**
 * 5c（驱动安装）给诊断用的能力；5c 合并之前在 index.ts 里是 null，「重新安装驱动」不出现。
 *
 * **`reinstall` 的契约：只在安装真正结束（成功或失败）之后才 resolve，不能在「已经开始安装」
 * 或拿到安装任务的初始状态时就 resolve。** 5c 的 `DriverStation.installForDriverName` 这类入口
 * 往往只负责起个头、立刻回一个状态，不代表装完了；接到这个接缝的适配器必须自己等到安装的终态
 * （settled：成功、失败或被拒绝提权），再把终态换成 `ActionResult`：
 * - 管理员确认被拒绝（Windows 的退出码 1223、ERROR_CANCELLED）→ `{ kind: 'declined' }`；
 * - 下载、校验或安装过程失败 → `{ kind: 'failed', detail: '…' }`（detail 是能给操作员看的中文说明）；
 * - 确认安装完成且成功 → `{ kind: 'done' }`。
 *
 * 「驱动已重新安装」这句话（core/diagnosis/fixes.ts 的 doneMessage）只在收到 `done` 时才会说出口，
 * 适配器把「已经开始」误当「已经做完」就会说错。
 */
export interface DriverReinstallSeam {
  /** 在线清单里有这台的型号、能下载核对后静默安装。 */
  canReinstall(printerName: string): Promise<boolean>;
  /** 弹一次管理员确认后重装；等安装结束（成功、失败或被拒绝提权）才 resolve，见上面的契约说明。 */
  reinstall(printerName: string): Promise<ActionResult>;
}
