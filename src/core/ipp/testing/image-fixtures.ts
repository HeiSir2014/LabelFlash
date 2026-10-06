/** 测试用的 PNG、JPEG 文件头：只有读大小要用的部分，不能真的解码。 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = [0x49, 0x48, 0x44, 0x52];
const IHDR_LENGTH = 13;
const BIT_DEPTH = 8;

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function u16(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

/** PNG 的开头：签名 + IHDR（长度、类型、宽、高、其余 5 字节 + CRC，CRC 不核对）。 */
export function pngHeader(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    ...PNG_SIGNATURE,
    ...u32(IHDR_LENGTH),
    ...IHDR,
    ...u32(width),
    ...u32(height),
    ...[BIT_DEPTH, 0, 0, 0, 0],
    ...u32(0),
  ]);
}

/** JPEG：SOI、一段 APP0、一段 DHT，然后是 sof 标记的帧头（精度、高、宽），最后是 SOS。 */
export function jpegHeader(width: number, height: number, sof = 0xc0): Uint8Array {
  return Uint8Array.from([
    ...[0xff, 0xd8],
    ...[0xff, 0xe0, ...u16(6), 0x4a, 0x46, 0x49, 0x46],
    ...[0xff, 0xc4, ...u16(4), 0, 0],
    ...[0xff, sof, ...u16(11), BIT_DEPTH, ...u16(height), ...u16(width), 1, 1, 0x11, 0],
    ...[0xff, 0xda, ...u16(2)],
  ]);
}
