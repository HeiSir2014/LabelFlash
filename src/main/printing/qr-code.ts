import QRCode, { type BitMatrix } from 'qrcode';
import { QR_ERROR_LEVELS, type QrErrorLevel } from '../../core/templates/template-model';

/**
 * 热敏标签机最常见的分辨率 203dpi（打印头一个点 ≈ 0.125mm）；驱动报告了分辨率时按驱动的（例如 300dpi）。
 * 二维码每个模块取整数个点：模块边缘落在点与点之间，打出来宽窄一致、边缘清晰；
 * 不是整数个点时，有的模块多一个点、有的少一个点，扫码枪容易读错。
 */
export const DEFAULT_PRINTER_DPI = 203;
const MM_PER_INCH = 25.4;
/** 在 203dpi 上：模块至少 2 个点（约 0.25mm），再小扫码枪和手机都很难稳定识别。 */
export const MIN_MODULE_DOTS = 2;
/** 在 203dpi 上：模块最多 8 个点（约 1mm），内容很短时二维码不会撑满方框，和文字之间始终留出至少 2 个模块的空白（静区）。 */
export const MAX_MODULE_DOTS = 8;

export function dotMm(dpi: number): number {
  return MM_PER_INCH / dpi;
}

/** 其他分辨率按比例换算点数，模块的实际毫米数和 203dpi 时一样：分辨率高的打印机不会把二维码打得更小。 */
export function moduleDotLimits(dpi: number): { min: number; max: number } {
  const scale = dpi / DEFAULT_PRINTER_DPI;
  return {
    min: Math.max(1, Math.round(MIN_MODULE_DOTS * scale)),
    max: Math.max(1, Math.round(MAX_MODULE_DOTS * scale)),
  };
}

export interface QrPlan {
  svg: string;
  /** 实际使用的容错等级（放不下时会比模板要求的低）。 */
  level: QrErrorLevel;
  moduleCount: number;
  moduleDots: number;
  /** 实际边长（mm），不超过模板给的方框。 */
  sizeMm: number;
}

/**
 * 从模板要求的容错等级开始，逐级降低，找第一个能以「每模块不小于最小点数」放进方框的等级；
 * 降到 L 仍放不下时返回 null（不印二维码，宁缺毋滥：印出来扫不了更误事）。
 */
export function planQr(
  text: string,
  preferred: QrErrorLevel,
  boxMm: number,
  dpi: number = DEFAULT_PRINTER_DPI,
): QrPlan | null {
  const dot = dotMm(dpi);
  const limits = moduleDotLimits(dpi);
  const boxDots = Math.floor(boxMm / dot + 1e-9);
  const levels = QR_ERROR_LEVELS.slice(0, QR_ERROR_LEVELS.indexOf(preferred) + 1).reverse();
  for (const level of levels) {
    const modules = createModules(text, level);
    if (!modules) {
      continue;
    }
    const moduleDots = Math.min(limits.max, Math.floor(boxDots / modules.size));
    if (moduleDots >= limits.min) {
      return {
        svg: modulesToSvg(modules),
        level,
        moduleCount: modules.size,
        moduleDots,
        sizeMm: modules.size * moduleDots * dot,
      };
    }
  }
  return null;
}

function createModules(text: string, level: QrErrorLevel): BitMatrix | null {
  try {
    return QRCode.create(text, { errorCorrectionLevel: level }).modules;
  } catch {
    // 数据量超出这一容错等级的最大容量。
    return null;
  }
}

/** 每行连续的深色模块合成一个矩形，路径短；crispEdges 让边缘对齐到打印点，不做抗锯齿。 */
function modulesToSvg(modules: BitMatrix): string {
  const size = modules.size;
  let path = '';
  for (let row = 0; row < size; row += 1) {
    let col = 0;
    while (col < size) {
      if (!modules.get(row, col)) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < size && modules.get(row, col)) {
        col += 1;
      }
      path += `M${start} ${row}h${col - start}v1H${start}z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><path d="${path}"/></svg>`;
}
