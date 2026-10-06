/** 局域网共享收的文档格式。 */
export const DOCUMENT_FORMATS = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/pwg-raster',
  'image/urf',
] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];
/** 「按内容自己认」：客户端不知道或不说格式时用它（也是 document-format-default）。 */
export const AUTO_FORMAT = 'application/octet-stream';
/** document-format-supported：自动 + 五种格式。 */
export const SUPPORTED_FORMATS: readonly string[] = [AUTO_FORMAT, ...DOCUMENT_FORMATS];

/** 客户端声明的格式是否支持（MIME 类型不分大小写）。 */
export function isSupportedFormat(value: string): boolean {
  return SUPPORTED_FORMATS.includes(value.toLowerCase());
}
