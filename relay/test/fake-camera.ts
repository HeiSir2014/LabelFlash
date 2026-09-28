/**
 * 给浏览器当假摄像头用的视频：Y4M（YUV4MPEG2）格式，每一帧都是白底上的一个二维码。
 * Chrome / Edge 用 --use-file-for-fake-video-capture 播放它，循环不停。
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

export async function writeQrVideo(path: string, text: string): Promise<void> {
  const luma = new Uint8Array(WIDTH * HEIGHT).fill(WHITE);
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const side = (modules.size + QUIET_ZONE_MODULES * 2) * MODULE_PX;
  if (side > HEIGHT) {
    throw new Error(`二维码太大（${side}px），放不进 ${WIDTH}×${HEIGHT} 的画面`);
  }
  const left = Math.floor((WIDTH - side) / 2);
  const top = Math.floor((HEIGHT - side) / 2);
  for (let row = 0; row < modules.size; row += 1) {
    for (let column = 0; column < modules.size; column += 1) {
      if (!modules.get(row, column)) {
        continue;
      }
      for (let y = 0; y < MODULE_PX; y += 1) {
        const lineStart = (top + (row + QUIET_ZONE_MODULES) * MODULE_PX + y) * WIDTH;
        const x = left + (column + QUIET_ZONE_MODULES) * MODULE_PX;
        luma.fill(BLACK, lineStart + x, lineStart + x + MODULE_PX);
      }
    }
  }
  const chroma = new Uint8Array((WIDTH / 2) * (HEIGHT / 2)).fill(NEUTRAL_CHROMA);
  const header = new TextEncoder().encode(`YUV4MPEG2 W${WIDTH} H${HEIGHT} F30:1 Ip A1:1 C420jpeg\n`);
  const frameHeader = new TextEncoder().encode('FRAME\n');
  const frameSize = frameHeader.length + luma.length + chroma.length * 2;
  const video = new Uint8Array(header.length + frameSize * FRAMES);
  video.set(header, 0);
  for (let frame = 0; frame < FRAMES; frame += 1) {
    let offset = header.length + frame * frameSize;
    for (const part of [frameHeader, luma, chroma, chroma]) {
      video.set(part, offset);
      offset += part.length;
    }
  }
  await writeFile(path, video);
}
