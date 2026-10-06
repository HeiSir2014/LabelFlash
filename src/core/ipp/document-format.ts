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

/** PDF 文件头：规范允许它出现在前 1024 字节里的任何位置（有的导出工具在前面加几个字节）。 */
const PDF_HEADER = '%PDF-';
const PDF_HEADER_WINDOW_BYTES = 1024;
const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
/** PWG 5102.4 的同步字 'RaS2'；Apple Raster 的文件头 'UNIRAST\0'。 */
const PWG_SYNC = [0x52, 0x61, 0x53, 0x32] as const;
const URF_MAGIC = [0x55, 0x4e, 0x49, 0x52, 0x41, 0x53, 0x54, 0x00] as const;

function startsWith(data: Uint8Array, magic: readonly number[]): boolean {
  return data.length >= magic.length && magic.every((value, index) => data[index] === value);
}

/**
 * 按文件头认格式（不信客户端声明的 document-format：它可能说错，也可能故意说错）；认不出返回 null。
 */
export function sniffFormat(data: Uint8Array): DocumentFormat | null {
  if (startsWith(data, PWG_SYNC)) {
    return 'image/pwg-raster';
  }
  if (startsWith(data, URF_MAGIC)) {
    return 'image/urf';
  }
  if (startsWith(data, JPEG_MAGIC)) {
    return 'image/jpeg';
  }
  if (startsWith(data, PNG_MAGIC)) {
    return 'image/png';
  }
  const head = new TextDecoder('latin1').decode(data.subarray(0, PDF_HEADER_WINDOW_BYTES));
  return head.includes(PDF_HEADER) ? 'application/pdf' : null;
}
