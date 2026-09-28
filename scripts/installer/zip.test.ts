import { describe, expect, test } from 'bun:test';
import { inflateRawSync } from 'node:zlib';
import { crc32, createZip, type ZipEntry } from './zip';

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;

/** 按 central directory 读回每个文件：验证偏移、长度、CRC 和压缩数据互相一致。 */
function readZip(zip: Buffer): ZipEntry[] {
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(END_OF_CENTRAL_DIRECTORY);
  const count = zip.readUInt16LE(end + 10);
  let cursor = zip.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    expect(zip.readUInt32LE(cursor)).toBe(CENTRAL_HEADER);
    const crc = zip.readUInt32LE(cursor + 16);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const size = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    expect(zip.readUInt32LE(localOffset)).toBe(LOCAL_HEADER);
    const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26);
    const data = inflateRawSync(zip.subarray(dataStart, dataStart + compressedSize));
    expect(data.length).toBe(size);
    expect(crc32(data)).toBe(crc);
    entries.push({ name, data });
    cursor += 46 + nameLength;
  }
  return entries;
}

describe('crc32', () => {
  test('matches the standard check value', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });
});

describe('createZip', () => {
  test('writes files that read back byte for byte, with forward-slash names', () => {
    const files: ZipEntry[] = [
      { name: 'install.xml', data: Buffer.from('<Window />') },
      { name: 'images/ring/p050.png', data: Buffer.alloc(4096, 7) },
    ];
    expect(readZip(createZip(files))).toEqual(files);
  });

  test('marks names as UTF-8 so non-ASCII paths survive', () => {
    const zip = createZip([{ name: '图片.png', data: Buffer.from('x') }]);
    const UTF8_FLAG = 0x0800;
    expect(zip.readUInt16LE(6) & UTF8_FLAG).toBe(UTF8_FLAG);
    expect(readZip(zip)[0]?.name).toBe('图片.png');
  });

  test('rejects backslashes, which the skin engine would read as part of the name', () => {
    expect(() => createZip([{ name: 'images\\a.png', data: Buffer.from('x') }])).toThrow('images\\a.png');
  });
});
