import type { MonoBitmap } from '../../../core/pdf/mono-pack';
import { blankPage, fill } from '../../../core/pdf/testing/synthetic-page';
import type { GrayImage } from '../../../core/templates/mono-image';
import type { PrintResult } from '../../../core/types';
import type { PageSize, RenderImageType } from '../../../shared/pdf-render-protocol';
import type { OpenedPdf, RenderedPage } from '../../pdf/pdf-render-host';
import type { IppDocumentRenderer, IppPieceStore } from '../ipp-job-processor';

const MM_PER_INCH = 25.4;
const POINTS_PER_INCH = 72;
/** 60×40mm 的 PDF 页（点）。 */
export const LABEL_PAGE: PageSize = {
  width: (60 / MM_PER_INCH) * POINTS_PER_INCH,
  height: (40 / MM_PER_INCH) * POINTS_PER_INCH,
};
export const A4_PAGE: PageSize = { width: 595, height: 842 };
export const PRINTED: PrintResult = {
  status: 'printed',
  jobId: 'j',
  scan: { raw: '', ruleId: 'ipp', ruleName: '局域网共享', fields: [] },
};

/** 假的渲染页：每页都是 image（默认白纸上一块黑），pages 是 PDF 的页面大小。 */
export class FakeRenderer implements IppDocumentRenderer {
  readonly calls: string[] = [];
  pages: PageSize[] = [LABEL_PAGE];
  image: GrayImage = fill(blankPage(120, 80), { x: 10, y: 10, width: 60, height: 40 });
  failure: Error | null = null;

  async open(_data: Uint8Array): Promise<OpenedPdf> {
    this.calls.push('open');
    this.throwIfFailing();
    return { pageCount: this.pages.length, pages: this.pages };
  }

  async openImage(_data: Uint8Array, type: RenderImageType): Promise<OpenedPdf> {
    this.calls.push(`open-image ${type}`);
    this.throwIfFailing();
    return { pageCount: 1, pages: [{ width: this.image.width, height: this.image.height }] };
  }

  async render(page: number, _size: PageSize, dpi: number): Promise<RenderedPage> {
    this.calls.push(`render ${page} ${dpi}`);
    this.throwIfFailing();
    return { image: this.image, dpi };
  }

  close(): void {
    this.calls.push('close');
  }

  private throwIfFailing(): void {
    if (this.failure !== null) {
      throw this.failure;
    }
  }
}

/** 内存里的位图缓存。 */
export class MemoryPieces implements IppPieceStore {
  readonly stored = new Map<string, MonoBitmap>();
  private count = 0;

  async save(bitmap: MonoBitmap): Promise<string> {
    this.count += 1;
    const key = `k${this.count}`;
    this.stored.set(key, bitmap);
    return key;
  }

  async load(key: string): Promise<MonoBitmap | null> {
    return this.stored.get(key) ?? null;
  }

  async remove(keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      this.stored.delete(key);
    }
  }
}
