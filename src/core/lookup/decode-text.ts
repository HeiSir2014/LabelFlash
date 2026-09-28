/**
 * CSV 文件的编码：先按 UTF-8 严格解码；不是合法 UTF-8 时按 GB18030（兼容 GBK）解码——
 * 中文版 Excel「另存为 CSV」默认就是 GBK，不能让用户先去折腾编码。
 */
export function decodeCsvBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('gb18030').decode(bytes);
  }
}
