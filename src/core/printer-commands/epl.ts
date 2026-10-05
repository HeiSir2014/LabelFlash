import { type MediaSetup, mmToDots, type PrinterAction, type PrinterCommandConfig } from './command-model';

/**
 * EPL2 指令（依据《EPL2 编程手册》）。每条指令以换行（LF）结尾；宽高、间隙按打印点：q 纸宽，Q 纸长和间隙 / 黑标。
 * 出纸方式不发（COMMAND_SET_LIMITS.epl.canSetFinish 为 false）：EPL 用 O 命令选，同一条命令还管切刀和热敏 / 热转印模式。
 */
const LINE_END = '\n';
/**
 * Q 命令第二个参数（间隙或黑标高度）的范围：手册写 203dpi 16–240 点、300dpi 18–240 点。
 * GAP_RANGE_MM 的下限 2mm 在 300dpi 下是 24 点，所以统一按 16 查就够。
 */
export const EPL_GAP_DOTS = { min: 16, max: 240 } as const;
/** 黑标纸在 Q 命令的第二个参数前加 B。 */
const BLACK_LINE_PREFIX = 'B';

function lines(commands: readonly string[]): string {
  return commands.map((command) => `${command}${LINE_END}`).join('');
}

/** 间隙换成打印点后不在 EPL 的范围里时，给操作员的说明；在范围里返回 null。 */
export function eplGapIssue(media: MediaSetup, dpi: number): string | null {
  const dots = mmToDots(media.gapMm, dpi);
  if (dots >= EPL_GAP_DOTS.min && dots <= EPL_GAP_DOTS.max) {
    return null;
  }
  return `EPL 的间隙 / 黑标要在 ${EPL_GAP_DOTS.min}–${EPL_GAP_DOTS.max} 个打印点之间，${media.gapMm}mm 在 ${dpi}dpi 下是 ${dots} 点：请改间隙或分辨率`;
}

/** 保存时发一次的设置；各项都不改时返回空字符串。范围由 printer-commands.ts 先查过。 */
export function eplSetup(config: PrinterCommandConfig, dpi: number): string {
  const commands: string[] = [];
  if (config.media !== null) {
    const prefix = config.media.sensing === 'mark' ? BLACK_LINE_PREFIX : '';
    commands.push(
      `q${mmToDots(config.media.widthMm, dpi)}`,
      `Q${mmToDots(config.media.heightMm, dpi)},${prefix}${mmToDots(config.media.gapMm, dpi)}`,
    );
  }
  if (config.density !== null) {
    commands.push(`D${config.density}`);
  }
  if (config.speed !== null) {
    commands.push(`S${config.speed}`);
  }
  if (config.orientation !== null) {
    // ZT：从图像缓冲区顶部开始打（默认）；ZB：从底部开始，即旋转 180°。
    commands.push(config.orientation === 'normal' ? 'ZT' : 'ZB');
  }
  return lines(commands);
}

/** 动作指令；不需要设置和分辨率。 */
export function eplAction(action: PrinterAction): string {
  switch (action) {
    case 'calibrate':
      // xa：自动测纸（AutoSense），量标签长度、定间隙传感器的门限。
      return lines(['xa']);
    case 'feed':
      // N 清空图像缓冲区，P1 打一张：打出一张空白标签，就是走一张纸。
      return lines(['N', 'P1']);
    case 'selfTest':
      // U：打印配置。
      return lines(['U']);
    case 'factoryReset':
      return lines(['^default']);
  }
}
