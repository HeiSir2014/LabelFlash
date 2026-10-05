import type { DriverHints } from '../drivers/driver-hints';
import type { CommandSet, CommandSetChoice, DetectedCommandSet } from './command-model';

/**
 * 驱动名里写着的指令集字样（必须单独成词）。只认指令集本身的名字，不认品牌和型号：
 * 仓库里不写品牌型号，按型号认的表在 5c 的在线清单里（DriverHints，见 ../drivers/driver-hints.ts）。
 */
const DRIVER_NAME_HINTS: readonly { commandSet: CommandSet; pattern: RegExp }[] = [
  { commandSet: 'tspl', pattern: /\bTSPL2?\b/i },
  { commandSet: 'zpl', pattern: /\bZPL(?:\s*II|2)?\b/i },
  { commandSet: 'epl', pattern: /\bEPL2?\b/i },
];

/** 驱动名里只写着一种指令集时返回它。写着两种的（例如双指令集的驱动）不猜：猜错了打印机不认这些指令。 */
export function guessFromDriverName(driverName: string): CommandSet | null {
  const matches = DRIVER_NAME_HINTS.filter((hint) => hint.pattern.test(driverName));
  return matches.length === 1 ? (matches[0]?.commandSet ?? null) : null;
}

/**
 * 「自动」认出的指令集：先查在线驱动清单（DriverHints，按型号，最可靠），再看驱动名；都认不出为 null。
 * 驱动名读不到（null）时两条路都走不了。
 */
export async function detectCommandSet(
  driverName: string | null,
  hints: DriverHints,
): Promise<DetectedCommandSet | null> {
  if (driverName === null) {
    return null;
  }
  const hint = hints.modelForDriverName(driverName);
  if (hint !== null && hint.commandSet !== null) {
    return { commandSet: hint.commandSet, source: 'catalog' };
  }
  const fromName = guessFromDriverName(driverName);
  return fromName === null ? null : { commandSet: fromName, source: 'driver-name' };
}

/** 实际用的指令集：手动选的；「自动」用认出的；「不发指令」和认不出时为 null（不发）。 */
export function effectiveCommandSet(choice: CommandSetChoice, detected: DetectedCommandSet | null): CommandSet | null {
  if (choice === 'none') {
    return null;
  }
  if (choice === 'auto') {
    return detected?.commandSet ?? null;
  }
  return choice;
}
