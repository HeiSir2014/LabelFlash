import { describe, expect, test } from 'bun:test';
import type { MonoBitmap } from '../../core/pdf/mono-pack';
import { PDF_PIECE_TEMPLATE_ID, type PdfLayout } from '../../core/pdf/pdf-model';
import { blankPage, gridPage } from '../../core/pdf/testing/synthetic-page';
import type { FieldsPrint } from '../../core/print-service';
import type { PrintResult } from '../../core/types';
import type { PdfStatus } from '../../shared/pdf';
import type { PageSize } from '../../shared/pdf-render-protocol';
import { type OpenedPdf, PDF_ISSUES, PdfRenderError, type RenderedPage } from './pdf-render-host';
import {
  PDF_STATION_ISSUES,
  type PdfDocumentRenderer,
  PdfStation,
  type PdfStationDeps,
  type PieceStore,
  tooManyPagesIssue,
} from './pdf-station';

const A4: PageSize = { width: 595, height: 842 };
const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n%test\n');
const PRINTED: PrintResult = {
  status: 'printed',
  jobId: 'j',
  scan: { raw: '', ruleId: 'pdf', ruleName: 'PDF 打印', fields: [] },
};
const LAYOUT: PdfLayout = { paperKey: '100x150', crop: 'split', boxes: [], mono: 'threshold', threshold: 128 };
const RUN_IDS = [
  '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  '3f2504e0-4f89-41d3-9a0c-0305e82c3302',
  '3f2504e0-4f89-41d3-9a0c-0305e82c3303',
];
/** 合成页面约 0.5mm 一个像素：按 48dpi 报给切分（4mm 的缝 = 8 像素）。 */
const SYNTHETIC_DPI = 48;

/** 假的渲染页：每页都是 2×2 的合成面单页（blank 里的页是白纸）；gate 不为 null 时每页等测试放行。 */
class FakeRenderer implements PdfDocumentRenderer {
  pageCount = 2;
  failure: Error | null = null;
  gate: (() => void)[] | null = null;
  readonly blank = new Set<number>();
  readonly renders: { page: number; dpi: number }[] = [];

  async open(_data: Uint8Array): Promise<OpenedPdf> {
    if (this.failure !== null) {
      throw this.failure;
    }
    const pages = this.pageCount <= 200 ? Array.from({ length: this.pageCount }, () => A4) : [];
    return { pageCount: this.pageCount, pages };
  }

  async render(page: number, _size: PageSize, dpi: number): Promise<RenderedPage> {
    this.renders.push({ page, dpi });
    const gate = this.gate;
    if (gate !== null) {
      await new Promise<void>((resolve) => gate.push(resolve));
    }
    if (this.failure !== null) {
      throw this.failure;
    }
    return { image: this.blank.has(page) ? blankPage(400, 560) : gridPage(), dpi: SYNTHETIC_DPI };
  }

  close(): void {}
}

class MemoryPieces implements PieceStore {
  readonly stored = new Map<string, MonoBitmap>();
  readonly touched: string[] = [];
  /** 不为 null 时每次 save() 都等测试放行（模拟存缓存比较慢的情形）。 */
  saveGate: (() => void)[] | null = null;
  private count = 0;

  async save(bitmap: MonoBitmap): Promise<string> {
    this.count += 1;
    const key = `k${this.count}`;
    const gate = this.saveGate;
    if (gate !== null) {
      await new Promise<void>((resolve) => gate.push(resolve));
    }
    this.stored.set(key, bitmap);
    return key;
  }

  async load(key: string): Promise<MonoBitmap | null> {
    return this.stored.get(key) ?? null;
  }

  async touch(key: string): Promise<void> {
    this.touched.push(key);
  }

  async remove(keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      this.stored.delete(key);
    }
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function waitUntil(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !condition(); attempt += 1) {
    await settle();
  }
  expect(condition()).toBe(true);
}

function createStation(overrides: Partial<PdfStationDeps> = {}) {
  const renderer = new FakeRenderer();
  const pieces = new MemoryPieces();
  const printed: FieldsPrint[] = [];
  const statuses: PdfStatus[] = [];
  const runIds = [...RUN_IDS];
  const deps: PdfStationDeps = {
    renderer,
    pieces,
    readFile: async () => PDF_BYTES,
    fileSize: async () => PDF_BYTES.length,
    dpiFor: async () => 50,
    printFields: async (input) => {
      printed.push(input);
      return PRINTED;
    },
    renderHtml: (template, content) => `<p data-template="${template.id}">${content}</p>`,
    createRunId: () => runIds.shift() ?? 'no-more-run-ids',
    schedule: (run) => {
      const timer = setTimeout(run, 0);
      return () => clearTimeout(timer);
    },
    onStatus: (status) => statuses.push(status),
    onJobsChanged: () => undefined,
    log: () => undefined,
    ...overrides,
  };
  return { station: new PdfStation(deps), renderer, pieces, printed, statuses };
}

async function loaded(overrides: Partial<PdfStationDeps> = {}) {
  const harness = createStation(overrides);
  const result = await harness.station.loadBytes('面单.pdf', PDF_BYTES);
  if (result.status !== 'loaded') {
    throw new Error(`not loaded: ${JSON.stringify(result)}`);
  }
  return harness;
}

async function laidOut(overrides: Partial<PdfStationDeps> = {}) {
  const harness = await loaded(overrides);
  const result = await harness.station.layout(LAYOUT);
  if (result.status !== 'ok') {
    throw new Error(`not laid out: ${JSON.stringify(result)}`);
  }
  return { ...harness, result };
}

/** 打印一直卡在第一张上：release 放行它（之后的每一张直接打完）。 */
function stuckOnFirstLabel() {
  const releases: (() => void)[] = [];
  const printFields = (_input: FieldsPrint) =>
    releases.length === 0
      ? new Promise<PrintResult>((resolve) => releases.push(() => resolve(PRINTED)))
      : Promise.resolve(PRINTED);
  return { printFields, release: () => releases[0]?.() };
}

describe('PdfStation files', () => {
  test('opens a PDF, suggests splitting and shows the first page', async () => {
    const { station, renderer } = createStation();
    expect(await station.loadBytes('面单.pdf', PDF_BYTES)).toMatchObject({
      status: 'loaded',
      document: { name: '面单.pdf', pageCount: 2, detected: 'split', firstPage: { width: 400, height: 560 } },
    });
    expect(renderer.renders).toEqual([{ page: 1, dpi: 96 }]);
    expect(station.status().fileName).toBe('面单.pdf');
  });

  test('refuses files that are not PDFs', async () => {
    const { station } = createStation();
    expect(await station.loadBytes('a.pdf', new TextEncoder().encode('hello'))).toEqual({
      status: 'invalid',
      issue: PDF_STATION_ISSUES.notPdf,
    });
  });

  test('checks the size of a file before reading it', async () => {
    let reads = 0;
    const { station } = createStation({
      fileSize: async () => 60 * 1024 * 1024,
      readFile: async () => {
        reads += 1;
        return PDF_BYTES;
      },
    });
    expect(await station.loadPath('C:/big.pdf')).toEqual({ status: 'invalid', issue: PDF_STATION_ISSUES.tooLarge });
    expect(reads).toBe(0);
  });

  test('refuses more than 200 pages', async () => {
    const { station, renderer } = createStation();
    renderer.pageCount = 201;
    expect(await station.loadBytes('a.pdf', PDF_BYTES)).toEqual({ status: 'invalid', issue: tooManyPagesIssue(201) });
  });

  test('passes on why the render page could not open the file', async () => {
    const { station, renderer } = createStation();
    renderer.failure = new PdfRenderError(PDF_ISSUES.password, 'PasswordException');
    expect(await station.loadBytes('a.pdf', PDF_BYTES)).toEqual({ status: 'invalid', issue: PDF_ISSUES.password });
  });
});

describe('PdfStation layout', () => {
  test('cuts every page into pieces on the paper at the printer resolution', async () => {
    const { result, renderer } = await laidOut();
    expect(result.pieces.map((piece) => piece.id)).toEqual(['1-1', '1-2', '1-3', '1-4', '2-1', '2-2', '2-3', '2-4']);
    expect(result.paper).toEqual({ widthMm: 100, heightMm: 150 });
    expect(renderer.renders.slice(1)).toEqual([
      { page: 1, dpi: 50 },
      { page: 2, dpi: 50 },
    ]);
    // 100×150mm 在 50dpi 上是 197×295 个点；缩略图按 2 倍缩小到不超过 240。
    expect(result.pieces[0]?.thumbnail).toMatchObject({ width: 99, height: 148 });
  });

  test('skips blank pages and says how many', async () => {
    const { station, renderer } = await loaded();
    renderer.blank.add(2);
    expect(await station.layout(LAYOUT)).toMatchObject({ status: 'ok', skippedPages: 1 });
  });

  test('a newer layout supersedes one still running and drops its pieces', async () => {
    const { station, renderer, pieces } = await loaded();
    const gate: (() => void)[] = [];
    renderer.gate = gate;
    const first = station.layout(LAYOUT);
    await settle();
    const second = station.layout({ ...LAYOUT, crop: 'page' });
    await settle();
    renderer.gate = null;
    for (const release of gate.splice(0)) {
      release();
    }
    expect(await first).toEqual({ status: 'superseded' });
    const latest = await second;
    expect(latest.status === 'ok' ? latest.pieces.map((piece) => piece.id) : latest).toEqual(['1-1', '2-1']);
    expect(pieces.stored.size).toBe(2);
  });

  // 存缓存是异步的：换文件发生在第 1 页第 1 块还在存缓存的时候（渲染本身没卡住）。之前的代码只在
  // render() 前后查了一次，这期间换了文件也照样会把第 2 页交给渲染页——可能问到已经被关掉、复用给
  // 新文档的渲染页。
  test('never asks the render port for another page once superseded while still saving a piece', async () => {
    const { station, renderer, pieces } = await loaded();
    const gate: (() => void)[] = [];
    pieces.saveGate = gate;
    const layoutPromise = station.layout(LAYOUT);
    await settle();
    await station.loadBytes('other.pdf', PDF_BYTES);
    pieces.saveGate = null;
    for (const release of gate.splice(0)) {
      release();
    }
    expect(await layoutPromise).toEqual({ status: 'superseded' });
    expect(renderer.renders.some((render) => render.page === 2)).toBe(false);
  });

  test('replaces the pieces of the previous layout', async () => {
    const { station, pieces } = await laidOut();
    expect(pieces.stored.size).toBe(8);
    await station.layout({ ...LAYOUT, crop: 'trim' });
    expect(pieces.stored.size).toBe(2);
  });

  test('needs an open file', async () => {
    expect(await createStation().station.layout(LAYOUT)).toEqual({
      status: 'invalid',
      issue: PDF_STATION_ISSUES.noDocument,
    });
  });

  test('reports a page that could not be drawn and stops processing', async () => {
    const { station, renderer } = await loaded();
    renderer.failure = new PdfRenderError(PDF_ISSUES.timeout, 'timed out');
    expect(await station.layout(LAYOUT)).toEqual({ status: 'invalid', issue: PDF_ISSUES.timeout });
    expect(station.status().processing).toBeNull();
  });
});

describe('PdfStation printing', () => {
  test('prints the chosen pieces in order with copies as PDF records', async () => {
    const { station, printed, result } = await laidOut();
    expect(await station.print({ runId: result.runId, pieceIds: ['1-2', '1-1'], copies: 2 })).toMatchObject({
      status: 'started',
      progress: { total: 4 },
    });
    await waitUntil(() => station.status().print?.state === 'done');
    expect(printed.map((input) => input.content)).toEqual([
      '面单.pdf 第 1 页第 2 张',
      '面单.pdf 第 1 页第 2 张',
      '面单.pdf 第 1 页第 1 张',
      '面单.pdf 第 1 页第 1 张',
    ]);
    expect(printed[0]).toMatchObject({
      source: 'pdf',
      caller: null,
      printerName: null,
      pdf: { file: '面单.pdf', page: 1, piece: 2 },
      template: { id: PDF_PIECE_TEMPLATE_ID, paper: { widthMm: 100, heightMm: 150 } },
    });
  });

  test('keeps the pieces that were printed when the layout changes', async () => {
    const { station, pieces, result } = await laidOut();
    await station.print({ runId: result.runId, pieceIds: ['1-1'], copies: 1 });
    await waitUntil(() => station.status().print?.state === 'done');
    await station.layout({ ...LAYOUT, crop: 'trim' });
    expect(pieces.stored.size).toBe(3);
  });

  test('refuses an old preview', async () => {
    const { station } = await laidOut();
    expect(await station.print({ runId: RUN_IDS[2] ?? '', pieceIds: ['1-1'], copies: 1 })).toEqual({
      status: 'invalid',
      issue: PDF_STATION_ISSUES.stale,
    });
  });

  test('refuses to change the layout or the file while printing', async () => {
    const { station, result } = await laidOut({ printFields: () => new Promise(() => undefined) });
    await station.print({ runId: result.runId, pieceIds: ['1-1'], copies: 1 });
    await settle();
    expect(await station.layout(LAYOUT)).toEqual({ status: 'invalid', issue: PDF_STATION_ISSUES.printing });
    expect(await station.loadBytes('b.pdf', PDF_BYTES)).toEqual({
      status: 'invalid',
      issue: PDF_STATION_ISSUES.printing,
    });
    expect(station.pendingLabels).toBe(1);
  });

  // 取消的那一刻正在打的那一张还没结束：这时还不能换文件、再打，界面要一直看到「还在打」。
  test('stays active after a cancel until the label being printed is done', async () => {
    const stuck = stuckOnFirstLabel();
    const { station, result } = await laidOut({ printFields: stuck.printFields });
    await station.print({ runId: result.runId, pieceIds: ['1-1', '1-2'], copies: 1 });
    await settle();
    station.cancel();
    await settle();
    expect(station.status()).toMatchObject({ isActive: true, print: { state: 'canceled' } });
    expect(station.pendingLabels).toBe(1);
    stuck.release();
    await station.whenIdle();
    expect(station.status().isActive).toBe(false);
    expect(station.pendingLabels).toBe(0);
  });

  test('previews one piece with the same HTML as printing', async () => {
    const { station, result } = await laidOut();
    expect(await station.previewPiece(result.runId, '2-3')).toEqual({
      status: 'ok',
      html: `<p data-template="${PDF_PIECE_TEMPLATE_ID}">面单.pdf 第 2 页第 3 张</p>`,
      paper: { widthMm: 100, heightMm: 150 },
    });
  });

  test('reads back a stored piece for the records and keeps it another week', async () => {
    const { station, pieces } = await laidOut();
    const key = [...pieces.stored.keys()][0] ?? '';
    expect(await station.storedPiece(key)).not.toBeNull();
    expect(pieces.touched).toEqual([key]);
    expect(await station.storedPiece('missing')).toBeNull();
  });
});

describe('PdfStation on quit', () => {
  test('has nothing to confirm when it is not printing', async () => {
    const { station } = await laidOut();
    expect(station.pendingQuit()).toBeNull();
  });

  // 正在打的那一张已经交给了打印机，可能已经出纸：只列还没轮到的，带着位图编号，退出后还能从打印记录重打。
  test('lists the pieces not yet handed to the printer, without the one being printed', async () => {
    const stuck = stuckOnFirstLabel();
    const { station, result, pieces } = await laidOut({ printFields: stuck.printFields });
    await station.print({ runId: result.runId, pieceIds: ['1-1', '2-3'], copies: 1 });
    await settle();
    const pending = station.pendingQuit();
    expect(pending?.labels).toEqual([
      {
        content: '面单.pdf 第 2 页第 3 张',
        fields: [
          { name: '文件', value: '面单.pdf' },
          { name: '页码', value: '2' },
          { name: '第几张', value: '3' },
        ],
        paper: { widthMm: 100, heightMm: 150 },
        pdf: { file: '面单.pdf', page: 2, piece: 3, bitmap: pending?.labels[0]?.pdf.bitmap ?? '' },
      },
    ]);
    expect(pieces.stored.has(pending?.labels[0]?.pdf.bitmap ?? '')).toBe(true);
    stuck.release();
    await station.whenIdle();
    expect(station.pendingQuit()).toBeNull();
  });
});
