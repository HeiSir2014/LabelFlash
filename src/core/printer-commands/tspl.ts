import { TENTHS_PER_MM } from '../../shared/paper-sizes';
import type { MediaSetup, PrinterAction, PrinterCommandConfig } from './command-model';

/**
 * TSPL / TSPL2 指令（依据《TSPL/TSPL2 编程手册》）。每条指令以 CR LF 结尾。
 * 纸张用手册的公制写法（SIZE m mm,n mm；GAP m mm,n mm；BLINE m mm,n mm）：不换算打印点，也就不需要分辨率。
 */
const LINE_END = '\r\n';
/** DIRECTION 的 0 和 1 相差 180°；0 当「正常」，哪个是出厂方向要真机核对（计划的真机验收）。 */
const DIRECTION_NORMAL = 0;
const DIRECTION_ROTATED = 1;

function mm(value: number): string {
  return `${Math.round(value * TENTHS_PER_MM) / TENTHS_PER_MM} mm`;
}

function lines(commands: readonly string[]): string {
  return commands.map((command) => `${command}${LINE_END}`).join('');
}

function mediaCommands(media: MediaSetup): string[] {
  // 第二个参数：GAP 是间隙的偏移，BLINE 是黑标之后多走的长度；标准标签纸都是 0。
  const mark = media.sensing === 'gap' ? 'GAP' : 'BLINE';
  return [`SIZE ${mm(media.widthMm)},${mm(media.heightMm)}`, `${mark} ${mm(media.gapMm)},0 mm`];
}

/** 保存时发一次的设置；各项都不改时返回空字符串。顺序固定：纸张 → 浓度 → 速度 → 方向 → 出纸方式。 */
export function tsplSetup(config: PrinterCommandConfig): string {
  const commands: string[] = [];
  if (config.media !== null) {
    commands.push(...mediaCommands(config.media));
  }
  if (config.density !== null) {
    commands.push(`DENSITY ${config.density}`);
  }
  if (config.speed !== null) {
    commands.push(`SPEED ${config.speed}`);
  }
  if (config.orientation !== null) {
    commands.push(`DIRECTION ${config.orientation === 'normal' ? DIRECTION_NORMAL : DIRECTION_ROTATED}`);
  }
  // 两种出纸方式只开一个：开一个就先关另一个，不留在两种模式都开着的状态。
  if (config.finish === 'tear') {
    commands.push('SET PEEL OFF', 'SET TEAR ON');
  } else if (config.finish === 'peel') {
    commands.push('SET TEAR OFF', 'SET PEEL ON');
  }
  return lines(commands);
}

/** 动作指令。纸张校准按保存的纸型：黑标纸 BLINEDETECT，其余（含没设纸张）GAPDETECT。 */
export function tsplAction(action: PrinterAction, config: PrinterCommandConfig): string {
  switch (action) {
    case 'calibrate':
      return lines([config.media?.sensing === 'mark' ? 'BLINEDETECT' : 'GAPDETECT']);
    case 'feed':
      return lines(['FORMFEED']);
    case 'selfTest':
      return lines(['SELFTEST']);
    case 'factoryReset':
      return lines(['INITIALPRINTER']);
  }
}
