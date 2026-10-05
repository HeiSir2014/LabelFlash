import { isSamePaper, type PaperSize } from '../../shared/paper-sizes';

const MICRONS_PER_MM = 1_000;
const MM_PER_INCH = 25.4;
/** 毫米保留两位小数写进纸张名：PWG 名字里的尺寸就是这个精度。 */
const HUNDREDTHS_PER_MM = 100;

/** 写进 PrintTicket 的选项名（XML 的 NCName，只收 ASCII）。 */
export const PRINT_TICKET_LOCAL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
/** 选项的命名空间（URI / URN）：只收不会破坏 XML 属性的 ASCII 字符。 */
export const PRINT_TICKET_NAMESPACE_PATTERN = /^[A-Za-z0-9:/._~%#?=+-]{1,256}$/;
/** CUPS 的纸张名（PWG 5101.1 的自描述名都是小写）。 */
export const CUPS_MEDIA_KEYWORD_PATTERN = /^[a-z0-9_.-]{1,64}$/;

/** 驱动 PrintCapabilities 里 PageMediaSize 的一个选项；尺寸以微米计，自定义尺寸那一项没有尺寸。 */
export interface PrintTicketPaperOption {
  namespace: string;
  localName: string;
  widthMicrons: number | null;
  heightMicrons: number | null;
}

export interface PrintTicketPaperOptions {
  options: PrintTicketPaperOption[];
  /** 驱动声明了 PageMediaSizeMediaSizeWidth 参数：能用 psk:CustomMediaSize。 */
  supportsCustom: boolean;
}

/** 要写进 PrintTicket 的纸张：驱动的一个选项，或自定义尺寸。 */
export type PrintTicketPaper =
  | { kind: 'option'; namespace: string; localName: string }
  | { kind: 'custom'; widthMicrons: number; heightMicrons: number };

function sizeError(size: PaperSize, target: PaperSize): number {
  return Math.abs(size.widthMm - target.widthMm) + Math.abs(size.heightMm - target.heightMm);
}

/**
 * 挑驱动里尺寸一致（isSamePaper，差 1mm 以内）的选项，几种都合适时取最接近的；
 * 没有就看驱动能不能自定义尺寸；都不行返回 null（这时不弹管理员确认，直接说明）。
 */
export function choosePrintTicketPaper(available: PrintTicketPaperOptions, target: PaperSize): PrintTicketPaper | null {
  let best: { option: PrintTicketPaperOption; error: number } | null = null;
  for (const option of available.options) {
    if (option.widthMicrons === null || option.heightMicrons === null) {
      continue;
    }
    const size = { widthMm: option.widthMicrons / MICRONS_PER_MM, heightMm: option.heightMicrons / MICRONS_PER_MM };
    if (!isSamePaper(size, target)) {
      continue;
    }
    const error = sizeError(size, target);
    if (best === null || error < best.error) {
      best = { option, error };
    }
  }
  if (best !== null) {
    return { kind: 'option', namespace: best.option.namespace, localName: best.option.localName };
  }
  if (available.supportsCustom) {
    return {
      kind: 'custom',
      widthMicrons: Math.round(target.widthMm * MICRONS_PER_MM),
      heightMicrons: Math.round(target.heightMm * MICRONS_PER_MM),
    };
  }
  return null;
}

const PWG_SIZE_PATTERN = /_(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(mm|in)$/;
const CUSTOM_MIN_PREFIX = 'custom_min_';
const CUSTOM_MAX_PREFIX = 'custom_max_';

/** PWG 自描述纸张名最后一段是尺寸（例如 om_60x40mm_60x40mm、oe_4x6-label_4x6in）。 */
export function pwgMediaSize(keyword: string): PaperSize | null {
  const match = PWG_SIZE_PATTERN.exec(keyword);
  if (match === null) {
    return null;
  }
  const scale = match[3] === 'in' ? MM_PER_INCH : 1;
  return {
    widthMm: Math.round(Number(match[1]) * scale * HUNDREDTHS_PER_MM) / HUNDREDTHS_PER_MM,
    heightMm: Math.round(Number(match[2]) * scale * HUNDREDTHS_PER_MM) / HUNDREDTHS_PER_MM,
  };
}

function formatMm(mm: number): string {
  return String(Math.round(mm * HUNDREDTHS_PER_MM) / HUNDREDTHS_PER_MM);
}

/**
 * 在 CUPS 的 media-supported 里挑尺寸一致的纸张名；没有时，若打印机声明了自定义尺寸范围
 * （custom_min_… / custom_max_…）且目标在范围内，用 PWG 的自定义名 custom_<名字>_<宽>x<高>mm。
 */
export function chooseCupsMedia(supported: readonly string[], target: PaperSize): string | null {
  let best: { keyword: string; error: number } | null = null;
  for (const keyword of supported) {
    if (keyword.startsWith(CUSTOM_MIN_PREFIX) || keyword.startsWith(CUSTOM_MAX_PREFIX)) {
      continue;
    }
    const size = pwgMediaSize(keyword);
    if (size === null || !isSamePaper(size, target) || !CUPS_MEDIA_KEYWORD_PATTERN.test(keyword)) {
      continue;
    }
    const error = sizeError(size, target);
    if (best === null || error < best.error) {
      best = { keyword, error };
    }
  }
  if (best !== null) {
    return best.keyword;
  }
  const min = supported.find((keyword) => keyword.startsWith(CUSTOM_MIN_PREFIX));
  const max = supported.find((keyword) => keyword.startsWith(CUSTOM_MAX_PREFIX));
  const minSize = min === undefined ? null : pwgMediaSize(min);
  const maxSize = max === undefined ? null : pwgMediaSize(max);
  if (minSize === null || maxSize === null) {
    return null;
  }
  const fits =
    target.widthMm >= minSize.widthMm &&
    target.widthMm <= maxSize.widthMm &&
    target.heightMm >= minSize.heightMm &&
    target.heightMm <= maxSize.heightMm;
  const dimensions = `${formatMm(target.widthMm)}x${formatMm(target.heightMm)}mm`;
  return fits ? `custom_${dimensions}_${dimensions}` : null;
}
