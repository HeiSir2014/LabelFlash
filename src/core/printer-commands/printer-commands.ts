import {
  COMMAND_SET_LIMITS,
  COMMAND_SET_NAMES,
  type CommandSet,
  type PrinterAction,
  type PrinterCommandConfig,
} from './command-model';
import { eplAction, eplGapIssue, eplSetup } from './epl';
import { tsplAction, tsplSetup } from './tspl';
import { zplAction, zplSetup } from './zpl';

/** 生成的指令（ASCII 文字，空字符串 = 没有要发的）；ok 为 false 时 issue 是给操作员看的中文原因。 */
export type CommandBuild = { ok: true; text: string } | { ok: false; issue: string };

/** 设置里有这种指令集没有的值时，给操作员的说明；都合适返回 null。 */
export function checkForCommandSet(set: CommandSet, config: PrinterCommandConfig, dpi: number): string | null {
  const limits = COMMAND_SET_LIMITS[set];
  const name = COMMAND_SET_NAMES[set];
  const { density, speed, finish, media } = config;
  if (density !== null && (density < limits.density.min || density > limits.density.max)) {
    return `${name} 的浓度是 ${limits.density.min}–${limits.density.max}，现在是 ${density}：请重新选浓度`;
  }
  if (speed !== null && !limits.speeds.includes(speed)) {
    return `${name} 没有这个速度（${speed}）：请重新选速度`;
  }
  if (finish !== null && !limits.canSetFinish) {
    return `${name} 不能设出纸方式（撕纸 / 剥离）：请改成「不改」`;
  }
  if (set === 'epl' && media !== null) {
    return eplGapIssue(media, dpi);
  }
  return null;
}

/** 保存时发一次的设置。dpi 只有 ZPL、EPL 用（宽高按打印点）。 */
export function buildSetup(set: CommandSet, config: PrinterCommandConfig, dpi: number): CommandBuild {
  const issue = checkForCommandSet(set, config, dpi);
  if (issue !== null) {
    return { ok: false, issue };
  }
  switch (set) {
    case 'tspl':
      return { ok: true, text: tsplSetup(config) };
    case 'zpl':
      return { ok: true, text: zplSetup(config, dpi) };
    case 'epl':
      return { ok: true, text: eplSetup(config, dpi) };
  }
}

/** 动作指令；这种指令集没有恢复出厂设置时说明原因。 */
export function buildAction(set: CommandSet, action: PrinterAction, config: PrinterCommandConfig): CommandBuild {
  if (action === 'factoryReset' && !COMMAND_SET_LIMITS[set].canFactoryReset) {
    return { ok: false, issue: `${COMMAND_SET_NAMES[set]} 没有恢复出厂设置的指令` };
  }
  switch (set) {
    case 'tspl':
      return { ok: true, text: tsplAction(action, config) };
    case 'zpl':
      return { ok: true, text: zplAction(action) };
    case 'epl':
      return { ok: true, text: eplAction(action) };
  }
}
