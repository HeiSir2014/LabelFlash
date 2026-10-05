import {
  COMMAND_DPI_CHOICES,
  COMMAND_SET_CHOICES,
  COMMAND_SET_LIMITS,
  COMMAND_SET_NAMES,
  type CommandSet,
  type CommandSetChoice,
  DEFAULT_GAP_MM,
  type DetectedCommandSet,
  FINISH_MODES,
  type FinishMode,
  type MediaSensing,
  type MediaSetup,
  PRINT_ORIENTATIONS,
  type PrinterAction,
  type PrinterCommandConfig,
  type PrintOrientation,
} from '../../../core/printer-commands/command-model';
import { effectiveCommandSet } from '../../../core/printer-commands/command-set';
import type { PaperSize } from '../../../shared/paper-sizes';
import type {
  NotSentReason,
  PrinterCommandResult,
  PrinterCommandsView,
  RawSendFailureKind,
} from '../../../shared/printer-commands';

/** 下拉框里「不改」对应的值。 */
export const UNCHANGED = '';
/** 读不到驱动分辨率时按 203dpi：和打印、主进程换算时一样。 */
const FALLBACK_DPI = 203;
/** 失败时系统给的说明最多显示这么多字，完整的在日志里。 */
const MAX_DETAIL_CHARS = 80;

export interface SelectOption {
  value: string;
  label: string;
}

/** 面板的表单：纸张总是有值（预填这台打印机负责的纸），mediaEnabled 决定发不发。 */
export interface CommandForm {
  commandSet: CommandSetChoice;
  density: number | null;
  speed: number | null;
  mediaEnabled: boolean;
  media: MediaSetup;
  orientation: PrintOrientation | null;
  finish: FinishMode | null;
  dpi: number | null;
}

export interface CommandMessage {
  tone: 'ok' | 'info' | 'error';
  text: string;
}

/** 正在做的事：保存并发送，或四个动作之一。 */
export type CommandRequest = 'save' | PrinterAction;

export const ACTION_LABELS: Readonly<Record<PrinterAction, string>> = {
  calibrate: '纸张校准',
  feed: '走一张纸',
  selfTest: '打印自检页',
  factoryReset: '恢复出厂设置',
};

/** 结果里说「××指令已发送」时用的名字。 */
const ACTION_NAMES: Readonly<Record<PrinterAction, string>> = {
  calibrate: '纸张校准',
  feed: '走纸',
  selfTest: '自检页',
  factoryReset: '恢复出厂设置',
};

export const ONE_WAY_HINT =
  '指令是单向的：程序只知道已经发出去，打印机有没有照做要看出纸。经驱动打印时，驱动「打印首选项」里的同名设置可能盖过这里的设置。';

export const SENSING_OPTIONS: ReadonlyArray<{ value: MediaSensing; label: string }> = [
  { value: 'gap', label: '间隙纸' },
  { value: 'mark', label: '黑标纸' },
];

export const ORIENTATION_OPTIONS: readonly SelectOption[] = [
  { value: UNCHANGED, label: '不改' },
  { value: 'normal', label: '正常' },
  { value: 'rotated', label: '旋转 180°' },
];

export const FINISH_OPTIONS: readonly SelectOption[] = [
  { value: UNCHANGED, label: '不改' },
  { value: 'tear', label: '撕纸' },
  { value: 'peel', label: '剥离（要装剥离器）' },
];

export function formFromConfig(config: PrinterCommandConfig, paper: PaperSize): CommandForm {
  return {
    commandSet: config.commandSet,
    density: config.density,
    speed: config.speed,
    mediaEnabled: config.media !== null,
    media: config.media ?? { widthMm: paper.widthMm, heightMm: paper.heightMm, sensing: 'gap', gapMm: DEFAULT_GAP_MM },
    orientation: config.orientation,
    finish: config.finish,
    dpi: config.dpi,
  };
}

export function configFromForm(form: CommandForm): PrinterCommandConfig {
  return {
    commandSet: form.commandSet,
    density: form.density,
    speed: form.speed,
    media: form.mediaEnabled ? form.media : null,
    orientation: form.orientation,
    finish: form.finish,
    dpi: form.dpi,
  };
}

/** 两份表单都由 formFromConfig / 展开生成，键的顺序相同，按 JSON 比较即可。 */
export function isFormDirty(form: CommandForm, saved: CommandForm): boolean {
  return JSON.stringify(form) !== JSON.stringify(saved);
}

/** 换指令集：新的指令集没有的浓度、速度、出纸方式回到「不改」（不悄悄换成别的值）。 */
export function withCommandSet(
  form: CommandForm,
  choice: CommandSetChoice,
  detected: DetectedCommandSet | null,
): CommandForm {
  const set = effectiveCommandSet(choice, detected);
  if (set === null) {
    return { ...form, commandSet: choice };
  }
  const limits = COMMAND_SET_LIMITS[set];
  const { density, speed } = form;
  return {
    ...form,
    commandSet: choice,
    density: density !== null && density >= limits.density.min && density <= limits.density.max ? density : null,
    speed: speed !== null && limits.speeds.includes(speed) ? speed : null,
    finish: limits.canSetFinish ? form.finish : null,
  };
}

export function commandSetOptions(detected: DetectedCommandSet | null): SelectOption[] {
  return COMMAND_SET_CHOICES.map((choice) => {
    switch (choice) {
      case 'auto':
        return {
          value: choice,
          label: `自动（${detected === null ? '认不出' : COMMAND_SET_NAMES[detected.commandSet]}）`,
        };
      case 'none':
        return { value: choice, label: '不发指令' };
      default:
        return { value: choice, label: COMMAND_SET_NAMES[choice] };
    }
  });
}

export function densityOptions(set: CommandSet): SelectOption[] {
  const { min, max } = COMMAND_SET_LIMITS[set].density;
  const values = Array.from({ length: max - min + 1 }, (_, index) => String(min + index));
  return [{ value: UNCHANGED, label: '不改' }, ...values.map((value) => ({ value, label: value }))];
}

/** TSPL、ZPL 的速度是英寸/秒；EPL 是档位（每档多快随机型不同，不写成英寸/秒）。 */
export function speedOptions(set: CommandSet): SelectOption[] {
  const label = (speed: number) => (set === 'epl' ? `第 ${speed} 档` : `${speed} 英寸/秒`);
  return [
    { value: UNCHANGED, label: '不改' },
    ...COMMAND_SET_LIMITS[set].speeds.map((speed) => ({ value: String(speed), label: label(speed) })),
  ];
}

export function dpiOptions(driverDpi: number | null): SelectOption[] {
  const fallback = driverDpi === null ? `读不到，按 ${FALLBACK_DPI}dpi` : `${driverDpi}dpi`;
  return [
    { value: UNCHANGED, label: `按驱动（${fallback}）` },
    ...COMMAND_DPI_CHOICES.map((dpi) => ({ value: String(dpi), label: `${dpi}dpi` })),
  ];
}

export function optionValue(value: number | null): string {
  return value === null ? UNCHANGED : String(value);
}

export function parseOption(value: string): number | null {
  return value === UNCHANGED ? null : Number(value);
}

export function orientationOf(value: string): PrintOrientation | null {
  return PRINT_ORIENTATIONS.find((item) => item === value) ?? null;
}

export function finishOf(value: string): FinishMode | null {
  return FINISH_MODES.find((item) => item === value) ?? null;
}

/** 「自动」下面那句：认出了说依据，认不出请操作员选。 */
export function describeDetection(view: Pick<PrinterCommandsView, 'detected' | 'driverName'>): string {
  const { detected, driverName } = view;
  if (detected === null) {
    const from = driverName === null ? '读不到驱动名' : `从驱动名「${driverName}」认不出用哪种指令`;
    return `${from}：请手动选择；不确定就选「不发指令」，打印照常经驱动`;
  }
  const name = COMMAND_SET_NAMES[detected.commandSet];
  return detected.source === 'catalog' ? `按在线识别表，这台用 ${name}` : `驱动名「${driverName ?? ''}」里写着 ${name}`;
}

export function canRunAction(set: CommandSet, action: PrinterAction): boolean {
  return action !== 'factoryReset' || COMMAND_SET_LIMITS[set].canFactoryReset;
}

/** 动作按钮灰掉的原因；能用时为 null。 */
export function actionsHint(savedSet: CommandSet | null, isDirty: boolean): string | null {
  if (isDirty) {
    return '有没保存的修改：下面的按钮按已保存的设置发送，先点「保存并发送」';
  }
  if (savedSet === null) {
    return '没有可用的指令集，下面的按钮不能用：先在「指令集」里选一种并保存';
  }
  return null;
}

const NOT_SENT_TEXTS: Readonly<Record<NotSentReason, string>> = {
  'no-command-set': '这台打印机设为「不发指令」，没有发送',
  'unknown-command-set': '认不出这台打印机用哪种指令，没有发送：请在「指令集」里选一种',
  'nothing-to-send': '各项都是「不改」，没有要发送的设置',
};

function failureText(reason: RawSendFailureKind, detail: string): string {
  switch (reason) {
    case 'not-found':
      return '发送失败：系统里找不到这台打印机。点「刷新」看看它还在不在';
    case 'access-denied':
      return '发送失败：没有向这台打印机发送的权限。在 Windows 打印机属性的「安全」里给当前用户「打印」权限后再试';
    case 'raw-rejected':
      return '发送失败：这台打印机的驱动不接受直接发送的指令。装热敏标签机厂家的驱动后再试；只想正常打印的话，把指令集改成「不发指令」';
    case 'uncertain':
      return '不确定有没有发出去：系统的打印服务没有及时回应。看看打印机有没有动作，再决定要不要重发';
    case 'unsupported':
      return '这个系统上不能直接向打印机发送指令';
    case 'error':
      return `发送失败：${detail.slice(0, MAX_DETAIL_CHARS)}。检查打印机是否开着、连好，再试一次`;
  }
}

/** 结果 → 面板上的一句话。只说程序知道的：发出去了，不说生效了。 */
export function describeCommandResult(result: PrinterCommandResult, request: CommandRequest): CommandMessage {
  switch (result.status) {
    case 'sent':
      return {
        tone: 'ok',
        text:
          request === 'save'
            ? `设置已发送到打印机（${COMMAND_SET_NAMES[result.commandSet]}）。指令是单向的：打一张看看效果`
            : `${ACTION_NAMES[request]}指令已发送到打印机`,
      };
    case 'not-sent':
      return { tone: 'info', text: `${request === 'save' ? '已保存。' : ''}${NOT_SENT_TEXTS[result.reason]}` };
    case 'invalid':
      return { tone: 'error', text: result.issue };
    case 'failed':
      return { tone: 'error', text: failureText(result.reason, result.detail) };
  }
}

export function factoryResetMessage(displayName: string): string {
  return `将向「${displayName}」发送恢复出厂设置：浓度、速度、纸张等设置回到出厂值，之后要重新做纸张校准。程序里保存的指令设置不变，需要时再点「保存并发送」。`;
}
