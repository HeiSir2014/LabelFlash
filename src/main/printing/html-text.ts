/** 标签、面单、自由设计共用的小工具：文本一律转义，尺寸一律写成毫米。 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 保留到 0.001mm：比打印点（约 0.02–0.125mm）细得多，又不会写出一长串小数。 */
export function mm(value: number): string {
  return `${Number(value.toFixed(3))}mm`;
}

/** 号码和条码之间的空隙（mm）：面单、自由设计共用，不能各写一份各改各的，两边会慢慢对不上。 */
export const BARCODE_TEXT_GAP_MM = 0.4;
/** 虚线：一段 1.2mm、空 0.8mm。面单、自由设计共用。 */
export const DASH_MM = 1.2;
export const DASH_GAP_MM = 0.8;
