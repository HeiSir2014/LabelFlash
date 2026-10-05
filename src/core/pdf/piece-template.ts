import type { PaperSize } from '../../shared/paper-sizes';
import type { ScanField } from '../scan/scan-result';
import type { CanvasTemplate } from '../templates/canvas-model';
import { encodeGray } from '../templates/mono-image';
import { type MonoBitmap, monoToGray } from './mono-pack';
import { PDF_LIMITS, PDF_PIECE_TEMPLATE_ID } from './pdf-model';

/** 黑白位图转回灰度（0 / 255）再按 128 一刀切：打出来正好是同一批点。 */
const PIECE_THRESHOLD = 128;
const PIECE_NAME = 'PDF';

/**
 * 一块 → 只有一张图的自由设计模板：图片框铺满纸，打印和预览都走 canvas-html 的 1 位 BMP 画法。
 * 位图已经是按目标打印机的点做好的；打印时换了分辨率不同的打印机，canvas-html 会按新的点数重新缩放。
 */
export function pieceTemplate(bitmap: MonoBitmap, paper: PaperSize): CanvasTemplate {
  const gray = monoToGray(bitmap);
  return {
    kind: 'canvas',
    id: PDF_PIECE_TEMPLATE_ID,
    name: PIECE_NAME,
    paper: { widthMm: paper.widthMm, heightMm: paper.heightMm },
    printer: null,
    elements: [
      {
        kind: 'image',
        id: 'pdf-piece',
        name: PIECE_NAME,
        x: 0,
        y: 0,
        width: paper.widthMm,
        height: paper.heightMm,
        rotation: 0,
        locked: true,
        pixels: encodeGray(gray),
        pixelWidth: gray.width,
        pixelHeight: gray.height,
        mode: 'threshold',
        threshold: PIECE_THRESHOLD,
      },
    ],
  };
}

/** 打印记录里的文件名：最多 PDF_LIMITS.fileNameChars 个字（按字符数，不切开汉字和表情）。 */
export function shortFileName(fileName: string): string {
  return [...fileName].slice(0, PDF_LIMITS.fileNameChars).join('');
}

/** 打印记录的内容（也是记录搜索、二维码「完整内容」的来源）：「面单.pdf 第 2 页第 1 张」。 */
export function pieceContent(fileName: string, page: number, piece: number): string {
  return `${shortFileName(fileName)} 第 ${page} 页第 ${piece} 张`;
}

/** 打印记录和打印结果通知里的字段。 */
export function pieceFields(fileName: string, page: number, piece: number): ScanField[] {
  return [
    { name: '文件', value: shortFileName(fileName) },
    { name: '页码', value: String(page) },
    { name: '第几张', value: String(piece) },
  ];
}
