import type { ReaderOptions, ReadResult } from 'zxing-wasm/reader';
import { decodeBarcodeBytes } from './barcode-text';

/**
 * 扫码页的解码选项（worker 和测试共用）。
 *
 * - 码制只开样衣间会遇到的：二维码、Data Matrix，以及订单号常用的一维码。
 *   不开 ITF 这类容易从杂乱画面里误识出数字的码制。
 * - 每帧只要一个码：扫到就停下来确认。
 */
export const READER_OPTIONS: ReaderOptions = {
  formats: ['QRCode', 'DataMatrix', 'Code128', 'Code39', 'EAN13', 'EAN8', 'UPCA'],
  textMode: 'Plain',
  maxNumberOfSymbols: 1,
  tryHarder: true,
};

/**
 * 码里的文字：声明了字符集（ECI）时按声明；没声明时 ZXing 靠猜，短的 GBK 中文会被猜错，
 * 所以按原始字节自己判断（见 barcode-text.ts）。
 */
export function barcodeText(result: Pick<ReadResult, 'hasECI' | 'text' | 'bytes'>): string {
  return result.hasECI ? result.text : decodeBarcodeBytes(result.bytes);
}
