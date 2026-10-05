/**
 * 标签机指令的模型。程序只发自己生成的设置和动作（浓度、速度、纸张、校准……），标签内容仍经驱动打印。
 * 指令是单向的：发出去以后程序不知道打印机有没有照做，界面只说「已发送到打印机」。
 */

/** 热敏标签机常见的三种指令集。 */
export const COMMAND_SETS = ['tspl', 'zpl', 'epl'] as const;
export type CommandSet = (typeof COMMAND_SETS)[number];

/** 界面和提示里的名字。 */
export const COMMAND_SET_NAMES: Readonly<Record<CommandSet, string>> = { tspl: 'TSPL', zpl: 'ZPL', epl: 'EPL' };

/** 每台打印机选的指令集：自动（默认）、指定一种，或不发指令（只经驱动打印）。 */
export const COMMAND_SET_CHOICES = ['auto', 'tspl', 'zpl', 'epl', 'none'] as const;
export type CommandSetChoice = (typeof COMMAND_SET_CHOICES)[number];

/** 打印机动作：纸张校准（自动测间隙或黑标）、走一张纸、打印自检页、恢复出厂设置。 */
export const PRINTER_ACTIONS = ['calibrate', 'feed', 'selfTest', 'factoryReset'] as const;
export type PrinterAction = (typeof PRINTER_ACTIONS)[number];

/** 纸张怎么分张：间隙纸（两张之间有空隙）或黑标纸（背面印黑条）。 */
export const MEDIA_SENSINGS = ['gap', 'mark'] as const;
export type MediaSensing = (typeof MEDIA_SENSINGS)[number];

/** 打印方向：正常，或旋转 180°。 */
export const PRINT_ORIENTATIONS = ['normal', 'rotated'] as const;
export type PrintOrientation = (typeof PRINT_ORIENTATIONS)[number];

/** 出纸方式：撕纸（停在撕纸口）或剥离（剥好底纸再递出，打印机要装剥离器）。 */
export const FINISH_MODES = ['tear', 'peel'] as const;
export type FinishMode = (typeof FINISH_MODES)[number];

/** 纸张：宽高（mm，和模板纸张同一范围）、分张方式、间隙或黑标的高度（mm）。 */
export interface MediaSetup {
  widthMm: number;
  heightMm: number;
  sensing: MediaSensing;
  gapMm: number;
}

/**
 * 一台打印机的指令设置。每一项为 null 都表示「不改」：这一项不发，打印机保持原来的设置；
 * 只发操作员明确设了的项，不会把没碰过的设置改成程序的默认值。
 */
export interface PrinterCommandConfig {
  commandSet: CommandSetChoice;
  density: number | null;
  speed: number | null;
  media: MediaSetup | null;
  orientation: PrintOrientation | null;
  finish: FinishMode | null;
  /** ZPL、EPL 按打印点下发宽高：用这个分辨率换算；null = 按驱动报告的（读不到按 203dpi）。 */
  dpi: number | null;
}

export const DEFAULT_COMMAND_CONFIG: PrinterCommandConfig = {
  commandSet: 'auto',
  density: null,
  speed: null,
  media: null,
  orientation: null,
  finish: null,
  dpi: null,
};

/** 一种指令集能设的范围。 */
export interface CommandSetLimits {
  density: { min: number; max: number };
  /** 能选的速度：TSPL、ZPL 是英寸/秒，EPL 是档位。 */
  speeds: readonly number[];
  canSetFinish: boolean;
  canFactoryReset: boolean;
  /** 宽高按打印点下发（要分辨率）。 */
  usesDots: boolean;
}

/**
 * 取值依据见计划「依据的指令」一节；手册的机型表里不是所有机型都有的速度不列。
 * TSPL 的 SPEED 速度表随机型不同（例如有的 200dpi 机型只列 4、6 ips，有的 300dpi 机型只列 3、5 ips）；
 * 手册里没有统一给出「桌面机通用」的档位，这里按多份 TSC 桌面机手册的交集取 2–5 ips，偏保守，
 * 真机验收时如果某一档打印机不认，再从这里删掉。
 */
export const COMMAND_SET_LIMITS: Readonly<Record<CommandSet, CommandSetLimits>> = {
  // DENSITY 0–15；SPEED 是英寸/秒，桌面机普遍有 2–5。纸张用毫米写，不要分辨率。
  tspl: {
    density: { min: 0, max: 15 },
    speeds: [2, 3, 4, 5],
    canSetFinish: true,
    canFactoryReset: true,
    usesDots: false,
  },
  // ~SD 00–30；^PR 是英寸/秒，桌面机 2–6。
  zpl: {
    density: { min: 0, max: 30 },
    speeds: [2, 3, 4, 5, 6],
    canSetFinish: true,
    canFactoryReset: true,
    usesDots: true,
  },
  // D 0–15；S 是档位，每档多快随机型，各机型都有 1–4。出纸方式不设：O 命令同一条里还管切刀和热敏 / 热转印模式。
  epl: {
    density: { min: 0, max: 15 },
    speeds: [1, 2, 3, 4],
    canSetFinish: false,
    canFactoryReset: true,
    usesDots: true,
  },
};

/** 「自动」和「不发指令」下保存的设置按它校验：几种指令集的并集，真正发送前再按认出的指令集把关。 */
export const WIDEST_LIMITS: CommandSetLimits = {
  density: {
    min: Math.min(...COMMAND_SETS.map((set) => COMMAND_SET_LIMITS[set].density.min)),
    max: Math.max(...COMMAND_SETS.map((set) => COMMAND_SET_LIMITS[set].density.max)),
  },
  speeds: [...new Set(COMMAND_SETS.flatMap((set) => COMMAND_SET_LIMITS[set].speeds))].sort((a, b) => a - b),
  canSetFinish: true,
  canFactoryReset: true,
  usesDots: true,
};

/**
 * 间隙 / 黑标的高度（mm）。市面上的标签纸是 2–5mm（纸卷外包装上会写）；下限 2mm 是 EPL 的 Q 命令下限
 * （16 点 @203dpi）；上限 10mm 在 TSPL（≤ 25.4mm）、EPL（≤ 240 点，600dpi 下约 10.2mm）里都放得下。
 */
export const GAP_RANGE_MM = { min: 2, max: 10 } as const;

/** 表单里间隙的默认值：最常见的标签纸间隙。 */
export const DEFAULT_GAP_MM = 2;

/** 能手动选的分辨率：热敏标签机只有这三档。 */
export const COMMAND_DPI_CHOICES = [203, 300, 600] as const;

/**
 * 一次发给打印机的指令上限 4KB：最长的一组（设置）不到 200 字节，留足余量；
 * 这条路只发我们生成的指令，不是通用的原始打印通道，上限也挡住编程错误。
 */
export const RAW_COMMAND_MAX_BYTES = 4_096;

const MM_PER_INCH = 25.4;

/** 毫米 → 整数个打印点（四舍五入）。 */
export function mmToDots(mm: number, dpi: number): number {
  return Math.round((mm * dpi) / MM_PER_INCH);
}

export function isPrinterAction(value: unknown): value is PrinterAction {
  return PRINTER_ACTIONS.some((action) => action === value);
}

/** 这台打印机保存的设置；没保存过是默认（自动、各项不改）。只读自己的键：打印机名可能是 __proto__ 这样的字。 */
export function configFor(
  configs: Readonly<Record<string, PrinterCommandConfig>>,
  printerName: string,
): PrinterCommandConfig {
  return Object.hasOwn(configs, printerName)
    ? (configs[printerName] ?? DEFAULT_COMMAND_CONFIG)
    : DEFAULT_COMMAND_CONFIG;
}

/** 换掉一台打印机的设置。fromEntries 按「定义自己的属性」写入：名为 __proto__ 的打印机也不会改到原型。 */
export function withPrinterConfig(
  configs: Readonly<Record<string, PrinterCommandConfig>>,
  printerName: string,
  config: PrinterCommandConfig,
): Record<string, PrinterCommandConfig> {
  return Object.fromEntries([
    ...Object.entries(configs).filter(([name]) => name !== printerName),
    [printerName, config],
  ]);
}

/** 「自动」认出的指令集和依据。catalog 来自 5c 的在线驱动清单（见 ../drivers/driver-hints.ts）。 */
export interface DetectedCommandSet {
  commandSet: CommandSet;
  source: 'catalog' | 'driver-name';
}
