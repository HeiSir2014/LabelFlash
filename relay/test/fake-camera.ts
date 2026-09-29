/**
 * 给浏览器当假摄像头用的视频：Y4M（YUV4MPEG2）格式，每一帧都是白底上的一个二维码。
 * Chrome / Edge 用 --use-file-for-fake-video-capture 播放它，循环不停。
 *
 * 货架号识别的测试用 shelfBar、rotated：二维码下方画一条黑条当作货架号那一行，整张标签顺时针转 90°
 * （标签横着拍）。扫码页按二维码的四个角截图，截出来黑条应当在二维码正下方。
 */
import { writeFile } from 'node:fs/promises';
import QRCode from 'qrcode';

const WIDTH = 640;
const HEIGHT = 480;
const FRAMES = 30;
/** 每个模块画成 8×8 像素，四周留 4 个模块的白边（二维码规范要求的静区）。 */
const MODULE_PX = 8;
const QUIET_ZONE_MODULES = 4;
const WHITE = 255;
const BLACK = 0;
/** 4:2:0 色度平面填中性值，画面就是黑白的。 */
const NEUTRAL_CHROMA = 128;

/** 标签上货架号那一行：二维码静区下方 SHELF_GAP_PX 处，高 SHELF_BAR_PX，和二维码一样宽。 */
const SHELF_GAP_PX = 10;
const SHELF_BAR_PX = 20;
/** 转 90° 时先画在一张正方形的标签上（边长 = 画面高度），再转进画面。 */
const LABEL_TOP_PX = 20;

export interface QrVideoOptions {
  /** 二维码下方画一条黑条（货架号那一行）。 */
  shelfBar?: boolean;
  /** 整张标签顺时针转 90°（横着拍）。 */
  rotated?: boolean;
}

export async function writeQrVideo(path: string, text: string, options: QrVideoOptions = {}): Promise<void> {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const side = (modules.size + QUIET_ZONE_MODULES * 2) * MODULE_PX;
  const labelSide = HEIGHT;
  const isLabel = options.shelfBar === true || options.rotated === true;
  // 先画在标签（或整个画面）上，需要时再转进画面。
  const canvasWidth = isLabel ? labelSide : WIDTH;
  const canvasHeight = isLabel ? labelSide : HEIGHT;
  const luma = new Uint8Array(canvasWidth * canvasHeight).fill(WHITE);
  if (side + (options.shelfBar ? SHELF_GAP_PX + SHELF_BAR_PX : 0) > canvasHeight) {
    throw new Error(`二维码太大（${side}px），放不进 ${canvasWidth}×${canvasHeight} 的画面`);
  }
  const left = Math.floor((canvasWidth - side) / 2);
  const top = isLabel ? LABEL_TOP_PX : Math.floor((canvasHeight - side) / 2);
  const labelWidth = canvasWidth;
  for (let row = 0; row < modules.size; row += 1) {
    for (let column = 0; column < modules.size; column += 1) {
      if (!modules.get(row, column)) {
        continue;
      }
      for (let y = 0; y < MODULE_PX; y += 1) {
        const lineStart = (top + (row + QUIET_ZONE_MODULES) * MODULE_PX + y) * labelWidth;
        const x = left + (column + QUIET_ZONE_MODULES) * MODULE_PX;
        luma.fill(BLACK, lineStart + x, lineStart + x + MODULE_PX);
      }
    }
  }
  if (options.shelfBar) {
    for (let y = 0; y < SHELF_BAR_PX; y += 1) {
      const lineStart = (top + side + SHELF_GAP_PX + y) * labelWidth;
      luma.fill(
        BLACK,
        lineStart + left + QUIET_ZONE_MODULES * MODULE_PX,
        lineStart + left + side - QUIET_ZONE_MODULES * MODULE_PX,
      );
    }
  }
  const frameLuma = isLabel ? placeLabel(luma, labelSide, options.rotated === true) : luma;
  const chroma = new Uint8Array((WIDTH / 2) * (HEIGHT / 2)).fill(NEUTRAL_CHROMA);
  const header = new TextEncoder().encode(`YUV4MPEG2 W${WIDTH} H${HEIGHT} F30:1 Ip A1:1 C420jpeg\n`);
  const frameHeader = new TextEncoder().encode('FRAME\n');
  const frameSize = frameHeader.length + frameLuma.length + chroma.length * 2;
  const video = new Uint8Array(header.length + frameSize * FRAMES);
  video.set(header, 0);
  for (let frame = 0; frame < FRAMES; frame += 1) {
    let offset = header.length + frame * frameSize;
    for (const part of [frameHeader, frameLuma, chroma, chroma]) {
      video.set(part, offset);
      offset += part.length;
    }
  }
  await writeFile(path, video);
}

/** 把正方形的标签放进画面中间；rotated 时顺时针转 90°：标签的 (x, y) 到画面的 (side-1-y, x)。 */
function placeLabel(label: Uint8Array, side: number, rotated: boolean): Uint8Array {
  const frame = new Uint8Array(WIDTH * HEIGHT).fill(WHITE);
  const offset = Math.floor((WIDTH - side) / 2);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const value = label[y * side + x] ?? WHITE;
      const [fx, fy] = rotated ? [side - 1 - y, x] : [x, y];
      frame[fy * WIDTH + offset + fx] = value;
    }
  }
  return frame;
}
