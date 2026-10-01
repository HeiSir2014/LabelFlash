/** 标签、面单 HTML 共用的小工具：文本一律转义，尺寸一律写成毫米。 */

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
