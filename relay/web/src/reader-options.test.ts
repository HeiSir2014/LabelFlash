import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { prepareZXingModule as prepareReader, readBarcodes } from 'zxing-wasm/reader';
import { prepareZXingModule as prepareWriter, writeBarcode } from 'zxing-wasm/writer';
import { barcodeText, READER_OPTIONS } from './reader-options';

const ZXING_DIST = join(import.meta.dir, '../../../node_modules/zxing-wasm/dist');
/** 每个模块画成 8×8 像素，四周留 4 个模块的白边（二维码规范要求的静区）。 */
const MODULE_PX = 8;
const QUIET_ZONE_MODULES = 4;
const LABEL_RAW = 'CL5640-TK-图片色-XL';
/** 「CL5640-TK-图片色-XL」的 GBK 编码：扫码枪和一些旧系统生成的二维码用它。 */
const LABEL_RAW_GBK = new Uint8Array([
  ...new TextEncoder().encode('CL5640-TK-'),
  0xcd,
  0xbc,
  0xc6,
  0xac,
  0xc9,
  0xab,
  ...new TextEncoder().encode('-XL'),
]);

interface Pixmap {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

function wasm(name: string): ArrayBuffer {
  const bytes = readFileSync(join(ZXING_DIST, name, `zxing_${name}.wasm`));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** 按页面拿到的格式（RGBA 的 ImageData）画出二维码。 */
function render(segments: QRCode.QRCodeSegment[] | string): Pixmap {
  const { modules } = QRCode.create(segments, { errorCorrectionLevel: 'M' });
  const side = (modules.size + QUIET_ZONE_MODULES * 2) * MODULE_PX;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let row = 0; row < modules.size; row += 1) {
    for (let column = 0; column < modules.size; column += 1) {
      if (!modules.get(row, column)) {
        continue;
      }
      for (let y = 0; y < MODULE_PX; y += 1) {
        for (let x = 0; x < MODULE_PX; x += 1) {
          const px = (column + QUIET_ZONE_MODULES) * MODULE_PX + x;
          const py = (row + QUIET_ZONE_MODULES) * MODULE_PX + y;
          data.fill(0, (py * side + px) * 4, (py * side + px) * 4 + 3);
        }
      }
    }
  }
  return { data, width: side, height: side };
}

async function decode(image: Pixmap | Blob): Promise<string | undefined> {
  // 页面拿到的是 ImageData；zxing 只看 data / width / height 三个字段。
  const [result] = await readBarcodes(image as ImageData | Blob, READER_OPTIONS);
  return result && barcodeText(result);
}

beforeAll(() => {
  prepareReader({ overrides: { wasmBinary: wasm('reader') } });
  prepareWriter({ overrides: { wasmBinary: wasm('writer') } });
});

describe('READER_OPTIONS', () => {
  test('reads a label QR code with Chinese text', async () => {
    expect(await decode(render(LABEL_RAW))).toBe(LABEL_RAW);
  });

  test('keeps the line breaks of a multi-line code', async () => {
    const raw = '订单号：20260929001\n款号：CL5640\n颜色：图片色';
    expect(await decode(render(raw))).toBe(raw);
  });

  test('reads a GBK-encoded code without a charset declaration as Chinese text', async () => {
    expect(new TextDecoder('gbk').decode(LABEL_RAW_GBK)).toBe(LABEL_RAW);
    expect(await decode(render([{ data: LABEL_RAW_GBK, mode: 'byte' }]))).toBe(LABEL_RAW);
  });

  test('reads a Code 128 order number', async () => {
    const { image } = await writeBarcode('20260929001', { format: 'Code128', scale: 3 });
    if (!image) {
      throw new Error('writer produced no image');
    }
    expect(await decode(image)).toBe('20260929001');
  });

  test('leaves out formats prone to false reads', () => {
    expect(READER_OPTIONS.formats).not.toContain('ITF');
  });
});
