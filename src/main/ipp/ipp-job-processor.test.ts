import { describe, expect, test } from 'bun:test';
import { IppJobBook } from '../../core/ipp/ipp-job-book';
import type { AcceptedDocument } from '../../core/ipp/ipp-operations';
import { rasterJobLimits } from '../../core/ipp/raster';
import { jpegHeader, pngHeader } from '../../core/ipp/testing/image-fixtures';
import { MINIMAL_PDF, testPrinter } from '../../core/ipp/testing/ipp-requests';
import { grayPage, pwgRaster } from '../../core/ipp/testing/raster-fixtures';
import { PDF_PIECE_TEMPLATE_ID } from '../../core/pdf/pdf-model';
import { blankPage, fill } from '../../core/pdf/testing/synthetic-page';
import type { FieldsPrint } from '../../core/print-service';
import { FakeClock } from '../../core/testing/fake-clock';
import type { PrintResult } from '../../core/types';
import { PDF_ISSUES, PdfRenderError } from '../pdf/pdf-render-host';
import type { ApprovalResult } from './client-approvals';
import type { AcceptedJob } from './ipp-http-server';
import { IPP_JOB_MESSAGES, IppJobProcessor, type IppJobProcessorDeps } from './ipp-job-processor';
import { A4_PAGE, FakeRenderer, LABEL_PAGE, MemoryPieces, PRINTED } from './testing/fakes';

function createProcessor(overrides: Partial<IppJobProcessorDeps> = {}) {
  const book = new IppJobBook(new FakeClock());
  const renderer = new FakeRenderer();
  const pieces = new MemoryPieces();
  const printed: FieldsPrint[] = [];
  const approval: { result: ApprovalResult } = { result: 'allowed' };
  const processor = new IppJobProcessor({
    renderer,
    pieces,
    book,
    dpiFor: async () => 203,
    waitForApproval: async () => approval.result,
    printFields: async (input) => {
      printed.push(input);
      return PRINTED;
    },
    onJobsChanged: () => undefined,
    onChange: () => undefined,
    log: () => undefined,
    ...overrides,
  });
  return { processor, book, renderer, pieces, printed, approval };
}

function acceptJob(book: IppJobBook, document: Partial<AcceptedDocument> = {}, needsApproval = false): AcceptedJob {
  const created = book.create({
    printerKey: '60x40',
    name: '面单',
    user: 'zhang',
    client: '192.168.1.23',
    sizeBytes: 100,
    held: needsApproval,
  });
  if (created.status !== 'created') {
    throw new Error(`not created: ${created.status}`);
  }
  return {
    job: created.job,
    printer: testPrinter(),
    document: { format: 'application/pdf', data: MINIMAL_PDF, copies: 1, ...document },
    needsApproval,
  };
}

describe('IppJobProcessor', () => {
  test('prints every page on the paper with collated copies as LAN share records', async () => {
    const { processor, book, renderer, printed } = createProcessor();
    renderer.pages = [LABEL_PAGE, LABEL_PAGE];
    const accepted = acceptJob(book, { copies: 2 });
    await processor.enqueue(accepted);
    expect(printed.map((input) => input.content)).toEqual([
      '面单 第 1 页第 1 张',
      '面单 第 2 页第 1 张',
      '面单 第 1 页第 1 张',
      '面单 第 2 页第 1 张',
    ]);
    expect(printed[0]).toMatchObject({
      source: 'ipp',
      caller: null,
      printerName: null,
      ipp: { client: '192.168.1.23', user: 'zhang' },
      pdf: { file: '面单', page: 1, piece: 1 },
      template: { id: PDF_PIECE_TEMPLATE_ID, paper: { widthMm: 60, heightMm: 40 } },
    });
    expect(renderer.calls).toEqual(['open', 'render 1 203', 'render 2 203', 'close']);
    expect(book.get(accepted.job.id)).toMatchObject({ state: 'completed', impressions: 4 });
  });

  test('trims an A4 page down to its content before fitting it on the label', async () => {
    const { processor, book, renderer, pieces } = createProcessor();
    renderer.pages = [A4_PAGE];
    renderer.image = fill(blankPage(400, 560), { x: 180, y: 260, width: 40, height: 28 });
    await processor.enqueue(acceptJob(book));
    const [bitmap] = [...pieces.stored.values()];
    const ink = bitmap === undefined ? 0 : bitmap.bits.filter((bit) => bit === 1).length / bitmap.bits.length;
    expect(ink).toBeGreaterThan(0.8);
  });

  test('waits for the operator and drops a refused job without opening it', async () => {
    const { processor, book, renderer, printed, approval } = createProcessor();
    approval.result = 'denied';
    const accepted = acceptJob(book, {}, true);
    await processor.enqueue(accepted);
    expect(printed).toEqual([]);
    expect(renderer.calls).toEqual([]);
    expect(book.get(accepted.job.id)).toMatchObject({ state: 'aborted', message: IPP_JOB_MESSAGES.denied });
  });

  test('prints a held job once the operator allows it', async () => {
    const { processor, book, printed } = createProcessor();
    const accepted = acceptJob(book, {}, true);
    await processor.enqueue(accepted);
    expect(printed).toHaveLength(1);
    expect(book.get(accepted.job.id)?.state).toBe('completed');
  });

  // 行程编码几百 KB 能写出几十亿像素：解码交给 sandbox 的渲染页，主进程不解。
  test('decodes PWG raster in the render page within the limits of the paper', async () => {
    const { processor, book, renderer, printed } = createProcessor();
    await processor.enqueue(acceptJob(book, { format: 'image/pwg-raster', data: pwgRaster([grayPage(479, 319)]) }));
    expect(printed).toHaveLength(1);
    expect(renderer.calls).toEqual(['open-raster image/pwg-raster', 'render-raster 1', 'close']);
    expect(renderer.rasterLimits).toEqual(rasterJobLimits({ widthMm: 60, heightMm: 40 }, 203));
  });

  test('refuses raster pages far larger than the paper', async () => {
    const { processor, book, printed } = createProcessor();
    const accepted = acceptJob(book, { format: 'image/pwg-raster', data: pwgRaster([grayPage(2000, 319)]) });
    await processor.enqueue(accepted);
    expect(printed).toEqual([]);
    expect(book.get(accepted.job.id)).toMatchObject({ state: 'aborted', message: IPP_JOB_MESSAGES.badRaster });
  });

  test('takes a cancel while a raster page is still being decoded', async () => {
    const { processor, book, renderer, printed } = createProcessor();
    const pages = [grayPage(479, 319), grayPage(479, 319), grayPage(479, 319)];
    const accepted = acceptJob(book, { format: 'image/pwg-raster', data: pwgRaster(pages) });
    const decoding = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    renderer.beforeRasterPage = async (page) => {
      if (page === 2) {
        decoding.resolve();
        await release.promise;
      }
    };
    const done = processor.enqueue(accepted);
    await decoding.promise;
    // 第 2 页还在解：主进程照样收下取消（对方的取消请求在这时到达）。
    expect(book.cancel(accepted.job.id, '192.168.1.23')).toBe('requested');
    release.resolve();
    await done;
    expect(book.get(accepted.job.id)?.state).toBe('canceled');
    expect(renderer.calls).not.toContain('render-raster 3');
    expect(printed).toEqual([]);
  });

  test('aborts with a reason when the raster is broken', async () => {
    const { processor, book } = createProcessor();
    const accepted = acceptJob(book, { format: 'image/pwg-raster', data: new TextEncoder().encode('RaS2xx') });
    await processor.enqueue(accepted);
    expect(book.get(accepted.job.id)).toMatchObject({ state: 'aborted', message: IPP_JOB_MESSAGES.badRaster });
  });

  test('opens images in the render page at their own size', async () => {
    const { processor, book, renderer, printed } = createProcessor();
    await processor.enqueue(acceptJob(book, { format: 'image/jpeg', data: jpegHeader(120, 80) }));
    expect(renderer.calls).toEqual(['open-image image/jpeg', 'render 1 72', 'close']);
    expect(printed).toHaveLength(1);
  });

  // 文件头声明的大小先在主进程里看：解码炸弹不交给渲染页。
  test('refuses an image whose header declares a huge size without decoding it', async () => {
    const { processor, book, renderer } = createProcessor();
    const accepted = acceptJob(book, { format: 'image/png', data: pngHeader(100_000, 100_000) });
    await processor.enqueue(accepted);
    expect(renderer.calls).not.toContain('open-image image/png');
    expect(book.get(accepted.job.id)).toMatchObject({ state: 'aborted', message: IPP_JOB_MESSAGES.imageTooLarge });
  });

  test('refuses an image whose size cannot be read without decoding it', async () => {
    const { processor, book, renderer } = createProcessor();
    const accepted = acceptJob(book, { format: 'image/jpeg', data: Uint8Array.of(0xff, 0xd8, 0xff) });
    await processor.enqueue(accepted);
    expect(renderer.calls).not.toContain('open-image image/jpeg');
    expect(book.get(accepted.job.id)).toMatchObject({ state: 'aborted', message: IPP_JOB_MESSAGES.badImage });
  });

  test('stops a job canceled while printing and drops the pieces it did not print', async () => {
    const holder: { book: IppJobBook | null; id: number } = { book: null, id: 0 };
    const { processor, book, renderer, pieces, printed } = createProcessor({
      printFields: async (input) => {
        printed.push(input);
        holder.book?.cancel(holder.id, '192.168.1.23');
        return PRINTED;
      },
    });
    renderer.pages = [LABEL_PAGE, LABEL_PAGE];
    const accepted = acceptJob(book);
    holder.book = book;
    holder.id = accepted.job.id;
    await processor.enqueue(accepted);
    expect(printed).toHaveLength(1);
    expect(book.get(accepted.job.id)?.state).toBe('canceled');
    expect(pieces.stored.size).toBe(1);
  });

  test('aborts with the reason when the label printer cannot print', async () => {
    const failed: PrintResult = { status: 'failed', reason: 'PRINTER_NOT_READY' };
    const { processor, book } = createProcessor({ printFields: async () => failed });
    const accepted = acceptJob(book);
    await processor.enqueue(accepted);
    expect(book.get(accepted.job.id)).toMatchObject({ state: 'aborted', message: IPP_JOB_MESSAGES.notReady });
  });

  test('finishes a blank document with a warning and prints nothing', async () => {
    const { processor, book, renderer, printed } = createProcessor();
    renderer.image = blankPage(120, 80);
    const accepted = acceptJob(book);
    await processor.enqueue(accepted);
    expect(printed).toEqual([]);
    expect(book.get(accepted.job.id)).toMatchObject({
      state: 'completed',
      reasons: ['job-completed-with-warnings'],
      message: IPP_JOB_MESSAGES.blank,
    });
  });

  test('aborts and closes the render page when the document cannot be opened', async () => {
    const { processor, book, renderer } = createProcessor();
    renderer.failure = new PdfRenderError(PDF_ISSUES.invalid, 'InvalidPDFException');
    const accepted = acceptJob(book);
    await processor.enqueue(accepted);
    expect(book.get(accepted.job.id)).toMatchObject({ state: 'aborted', message: PDF_ISSUES.invalid });
    expect(renderer.calls.at(-1)).toBe('close');
  });

  test('skips a job that was canceled while it waited in the queue', async () => {
    const { processor, book, renderer, printed } = createProcessor();
    const accepted = acceptJob(book);
    book.cancel(accepted.job.id, '192.168.1.23');
    await processor.enqueue(accepted);
    expect(printed).toEqual([]);
    expect(renderer.calls).toEqual([]);
  });
});
