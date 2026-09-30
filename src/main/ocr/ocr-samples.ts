/**
 * 识别样本：电脑每次识别手机发来的标签图，都把图和读到的文字留在数据目录的 ocr-samples/ 里（只留最近几张）。
 * 货架号认不出时，要看手机实际拍到了什么才知道是哪一环出了问题（拍糊了、截歪了、还是字读错了）；
 * 打印记录里只有结果，没有图。样本只在本机，不上传；按文件名（时间）轮换，不会越积越多。
 */
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ImageTextRegion, ScanImage } from '../../core/scan/image-text';

export const OCR_SAMPLES_DIR_NAME = 'ocr-samples';
/** 留多少张：够看最近一轮试扫（每张约 100 KB，20 张约 2 MB）。 */
export const OCR_SAMPLES_KEPT = 20;

/** 日志里的一行：读到的每段文字和把握，货架号没认出时看日志就知道读成了什么。 */
export function describeRecognition(regions: readonly ImageTextRegion[], durationMs: number): string {
  const head = `[ocr] read ${regions.length} texts in ${Math.round(durationMs)} ms`;
  if (regions.length === 0) {
    return head;
  }
  return `${head}: ${regions.map((region) => `${JSON.stringify(region.text)} ${region.score.toFixed(2)}`).join(' | ')}`;
}

/** 文件名用的时间（UTC）：按名字排序就是按时间排序。 */
function stamp(time: number): string {
  const iso = new Date(time).toISOString();
  return `${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 19).replaceAll(':', '')}-${iso.slice(20, 23)}`;
}

export class OcrSamples {
  private lastName = '';
  private sameNameCount = 0;

  constructor(
    private readonly dir: string,
    private readonly keep: number,
    private readonly now: () => number,
  ) {}

  /** 存一张：标签图（原样的 JPEG）和识别结果（二维码位置、每段文字的框和把握）。 */
  async save(image: ScanImage, regions: readonly ImageTextRegion[]): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const name = this.uniqueName();
    await writeFile(join(this.dir, `${name}.jpg`), image.jpeg);
    await writeFile(join(this.dir, `${name}.json`), JSON.stringify({ code: image.code, regions }, null, 2));
    await this.prune();
  }

  /** 同一毫秒存了两张（连扫）时加序号，不覆盖前一张。 */
  private uniqueName(): string {
    const name = stamp(this.now());
    if (name === this.lastName) {
      this.sameNameCount += 1;
      return `${name}-${this.sameNameCount}`;
    }
    this.lastName = name;
    this.sameNameCount = 0;
    return name;
  }

  private async prune(): Promise<void> {
    const samples = [...new Set((await readdir(this.dir)).map((file) => file.replace(/\.(jpg|json)$/, '')))].sort();
    for (const name of samples.slice(0, -this.keep)) {
      await rm(join(this.dir, `${name}.jpg`), { force: true });
      await rm(join(this.dir, `${name}.json`), { force: true });
    }
  }
}
