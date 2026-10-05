import { PAPER_LIMITS_MM } from '../../shared/paper-sizes';
import {
  COMMAND_DPI_CHOICES,
  COMMAND_SET_CHOICES,
  COMMAND_SET_LIMITS,
  COMMAND_SETS,
  type CommandSetChoice,
  type CommandSetLimits,
  DEFAULT_COMMAND_CONFIG,
  FINISH_MODES,
  type FinishMode,
  GAP_RANGE_MM,
  MEDIA_SENSINGS,
  type MediaSetup,
  PRINT_ORIENTATIONS,
  type PrinterCommandConfig,
  WIDEST_LIMITS,
} from './command-model';

type Loose = Record<string, unknown>;

/** 每一项读出来的值：undefined = 不合法（缺了、类型不对、超出范围）；null = 不改。 */
type ReadFields = { [K in keyof PrinterCommandConfig]: PrinterCommandConfig[K] | undefined };

/** 毫米数保留一位小数：和纸张键的精度一致。 */
const TENTHS_PER_MM = 10;

function asLoose(value: unknown): Loose | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Loose) : null;
}

/** 手动选了指令集就按它的范围；「自动」「不发指令」按最宽的范围（发送前再按认出的指令集把关）。 */
function limitsFor(choice: CommandSetChoice | undefined): CommandSetLimits {
  const set = COMMAND_SETS.find((item) => item === choice);
  return set === undefined ? WIDEST_LIMITS : COMMAND_SET_LIMITS[set];
}

function readOneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null | undefined {
  return value === null ? null : allowed.find((item) => item === value);
}

function readNumberOf(value: unknown, allowed: readonly number[]): number | null | undefined {
  return value === null ? null : allowed.find((item) => item === value);
}

function readInteger(value: unknown, range: { min: number; max: number }): number | null | undefined {
  if (value === null) {
    return null;
  }
  return typeof value === 'number' && Number.isInteger(value) && value >= range.min && value <= range.max
    ? value
    : undefined;
}

function readMm(value: unknown, range: { readonly min: number; readonly max: number }): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  const rounded = Math.round(value * TENTHS_PER_MM) / TENTHS_PER_MM;
  return rounded >= range.min && rounded <= range.max ? rounded : undefined;
}

function readMedia(value: unknown): MediaSetup | null | undefined {
  if (value === null) {
    return null;
  }
  const media = asLoose(value);
  if (media === null) {
    return undefined;
  }
  const widthMm = readMm(media['widthMm'], PAPER_LIMITS_MM.width);
  const heightMm = readMm(media['heightMm'], PAPER_LIMITS_MM.height);
  const sensing = MEDIA_SENSINGS.find((item) => item === media['sensing']);
  const gapMm = readMm(media['gapMm'], GAP_RANGE_MM);
  if (widthMm === undefined || heightMm === undefined || sensing === undefined || gapMm === undefined) {
    return undefined;
  }
  return { widthMm, heightMm, sensing, gapMm };
}

function readFields(input: Loose): ReadFields {
  const commandSet = COMMAND_SET_CHOICES.find((choice) => choice === input['commandSet']);
  const limits = limitsFor(commandSet);
  return {
    commandSet,
    density: readInteger(input['density'], limits.density),
    speed: readNumberOf(input['speed'], limits.speeds),
    media: readMedia(input['media']),
    orientation: readOneOf(input['orientation'], PRINT_ORIENTATIONS),
    finish: readOneOf<FinishMode>(input['finish'], limits.canSetFinish ? FINISH_MODES : []),
    dpi: readNumberOf(input['dpi'], COMMAND_DPI_CHOICES),
  };
}

/** 设置表里读出来的（不可信）：不合法的项回到「不改」，指令集回到「自动」，不报错。 */
export function sanitizeCommandConfig(value: unknown): PrinterCommandConfig {
  const fields = readFields(asLoose(value) ?? {});
  return {
    commandSet: fields.commandSet ?? DEFAULT_COMMAND_CONFIG.commandSet,
    density: fields.density ?? null,
    speed: fields.speed ?? null,
    media: fields.media ?? null,
    orientation: fields.orientation ?? null,
    finish: fields.finish ?? null,
    dpi: fields.dpi ?? null,
  };
}

/**
 * 渲染进程交来的（IPC 信任边界）：每一项都要有、都合法，有一项不对就整个不收（返回 null，由 IPC 报错）。
 * 不纠正、不兜底：界面自己负责交合法的设置。
 */
export function parseCommandConfig(value: unknown): PrinterCommandConfig | null {
  const input = asLoose(value);
  if (input === null) {
    return null;
  }
  const { commandSet, density, speed, media, orientation, finish, dpi } = readFields(input);
  if (
    commandSet === undefined ||
    density === undefined ||
    speed === undefined ||
    media === undefined ||
    orientation === undefined ||
    finish === undefined ||
    dpi === undefined
  ) {
    return null;
  }
  return { commandSet, density, speed, media, orientation, finish, dpi };
}
