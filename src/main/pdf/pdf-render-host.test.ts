import { describe, expect, test } from 'bun:test';
import type { RenderRequest } from '../../shared/pdf-render-protocol';
import { PDF_ISSUES, PdfOpenSupersededError, PdfRenderHost, type RenderPort } from './pdf-render-host';

const A4 = { width: 595, height: 842 };

class FakePort implements RenderPort {
  readonly sent: RenderRequest[] = [];
  closed = false;
  private replyListener: ((message: unknown) => void) | null = null;
  private goneListener: (() => void) | null = null;

  send(request: RenderRequest): void {
    this.sent.push(request);
  }

  onReply(listener: (message: unknown) => void): void {
    this.replyListener = listener;
  }

  onGone(listener: () => void): void {
    this.goneListener = listener;
  }

  close(): void {
    this.closed = true;
  }

  reply(message: unknown): void {
    this.replyListener?.(message);
  }

  gone(): void {
    this.goneListener?.();
  }
}

/** 等 openPort 和发请求之间的微任务跑完。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function createHost() {
  const ports: FakePort[] = [];
  const timers: (() => void)[] = [];
  const logs: string[] = [];
  const host = new PdfRenderHost({
    openPort: async () => {
      const port = new FakePort();
      ports.push(port);
      return port;
    },
    openTimeoutMs: 20_000,
    pageTimeoutMs: 30_000,
    schedule: (run) => {
      timers.push(run);
      return () => {
        timers.splice(timers.indexOf(run), 1);
      };
    },
    log: (line) => logs.push(line),
  });
  return { host, ports, timers, logs };
}

/** 打开一个一页的 A4。 */
async function opened() {
  const harness = createHost();
  const opening = harness.host.open(Uint8Array.of(1));
  await settle();
  const port = harness.ports[0];
  if (port === undefined) {
    throw new Error('no render page was opened');
  }
  port.reply({ id: port.sent[0]?.id, kind: 'opened', pageCount: 1, pages: [A4] });
  await opening;
  return { ...harness, port };
}

describe('PdfRenderHost', () => {
  test('opens a document in a new render page and lists its pages', async () => {
    const { host, ports } = createHost();
    const opening = host.open(Uint8Array.of(1, 2));
    await settle();
    const request = ports[0]?.sent[0];
    expect(request).toMatchObject({ kind: 'open', data: Uint8Array.of(1, 2) });
    ports[0]?.reply({ id: request?.id, kind: 'opened', pageCount: 1, pages: [A4] });
    expect(await opening).toEqual({ pageCount: 1, pages: [A4] });
  });

  test('opens a JPEG or PNG as a one-page document in the render page', async () => {
    const { host, ports } = createHost();
    const opening = host.openImage(Uint8Array.of(0xff, 0xd8, 0xff), 'image/jpeg');
    await settle();
    const request = ports[0]?.sent[0];
    expect(request).toMatchObject({ kind: 'open-image', type: 'image/jpeg', data: Uint8Array.of(0xff, 0xd8, 0xff) });
    ports[0]?.reply({ id: request?.id, kind: 'opened', pageCount: 1, pages: [{ width: 640, height: 480 }] });
    expect(await opening).toEqual({ pageCount: 1, pages: [{ width: 640, height: 480 }] });
  });

  test('renders an opened image at its own size', async () => {
    const { host, ports } = createHost();
    const opening = host.openImage(Uint8Array.of(0x89), 'image/png');
    await settle();
    const port = ports[0];
    port?.reply({ id: port.sent[0]?.id, kind: 'opened', pageCount: 1, pages: [{ width: 4, height: 2 }] });
    await opening;
    const rendering = host.render(1, { width: 4, height: 2 }, 72);
    expect(port?.sent[1]).toMatchObject({ kind: 'render', page: 1, scale: 1 });
    port?.reply({ id: port.sent[1]?.id, kind: 'rendered', width: 4, height: 2, gray: new Uint8Array(8) });
    expect((await rendering).image).toMatchObject({ width: 4, height: 2 });
  });

  test('hands raster to the render page and reads back each page at its own size', async () => {
    const { host, ports } = createHost();
    const limits = { maxSideDots: 960, maxTotalPixels: 1_000 };
    const opening = host.openRaster(Uint8Array.of(0x52), 'image/pwg-raster', limits);
    await settle();
    const port = ports[0];
    expect(port?.sent[0]).toMatchObject({ kind: 'open-raster', type: 'image/pwg-raster', limits });
    port?.reply({ id: port.sent[0]?.id, kind: 'raster-opened', pages: [{ width: 4, height: 2, dpi: 203 }] });
    const opened = await opening;
    expect(opened).toEqual([{ width: 4, height: 2, dpi: 203 }]);
    const rendering = host.renderRaster(1, { width: 4, height: 2, dpi: 203 });
    expect(port?.sent[1]).toMatchObject({ kind: 'render-raster', page: 1 });
    port?.reply({ id: port.sent[1]?.id, kind: 'rendered', width: 4, height: 2, gray: new Uint8Array(8) });
    expect(await rendering).toMatchObject({ image: { width: 4, height: 2 }, dpi: 203 });
  });

  test('renders a page at the requested resolution', async () => {
    const { host, port } = await opened();
    const rendering = host.render(1, A4, 72);
    const request = port.sent[1];
    expect(request).toMatchObject({ kind: 'render', page: 1, scale: 1 });
    port.reply({ id: request?.id, kind: 'rendered', width: 595, height: 842, gray: new Uint8Array(595 * 842) });
    const { image, dpi } = await rendering;
    expect([image.width, image.height, dpi]).toEqual([595, 842, 72]);
  });

  test('refuses a bitmap of the wrong size and stops using that render page', async () => {
    const { host, port, logs } = await opened();
    const rendering = host.render(1, A4, 72);
    port.reply({ id: port.sent[1]?.id, kind: 'rendered', width: 594, height: 842, gray: new Uint8Array(594 * 842) });
    await expect(rendering).rejects.toMatchObject({ issue: PDF_ISSUES.failed });
    expect(port.closed).toBe(true);
    expect(logs.join('\n')).toContain('malformed');
  });

  test('explains a password-protected PDF', async () => {
    const { host, ports } = createHost();
    const opening = host.open(Uint8Array.of(1));
    await settle();
    ports[0]?.reply({ id: ports[0]?.sent[0]?.id, kind: 'error', error: 'password', detail: 'PasswordException' });
    await expect(opening).rejects.toMatchObject({ issue: PDF_ISSUES.password });
  });

  test('gives up on a page that takes too long and closes the stuck render page', async () => {
    const { host, port, timers, logs } = await opened();
    const rendering = host.render(1, A4, 203);
    timers[0]?.();
    await expect(rendering).rejects.toMatchObject({ issue: PDF_ISSUES.timeout });
    expect(port.closed).toBe(true);
    expect(logs.join('\n')).toContain('timed out');
  });

  test('fails waiting requests when the render page dies', async () => {
    const { host, port } = await opened();
    const rendering = host.render(1, A4, 203);
    port.gone();
    await expect(rendering).rejects.toMatchObject({ issue: PDF_ISSUES.gone });
  });

  test('closes the previous render page when another PDF is opened', async () => {
    const { host, port, ports } = await opened();
    void host.open(Uint8Array.of(2)).catch(() => undefined);
    await settle();
    expect(port.closed).toBe(true);
    expect(ports).toHaveLength(2);
  });

  test('refuses to render before a PDF is open', async () => {
    const { host } = createHost();
    await expect(host.render(1, A4, 203)).rejects.toMatchObject({ issue: PDF_ISSUES.gone });
  });
});

describe('PdfRenderHost with slow render pages', () => {
  /** 渲染页由测试决定什么时候建好：两次打开可以交错。 */
  function createSlowHost() {
    const pending: ((port: FakePort) => void)[] = [];
    const host = new PdfRenderHost({
      openPort: () => new Promise<RenderPort>((resolve) => pending.push(resolve)),
      openTimeoutMs: 20_000,
      pageTimeoutMs: 30_000,
      schedule: () => () => {},
      log: () => {},
    });
    return { host, pending };
  }

  test('closes the render page of an open that a newer open superseded', async () => {
    const { host, pending } = createSlowHost();
    const first = host.open(Uint8Array.of(1));
    const second = host.open(Uint8Array.of(2));
    const firstPort = new FakePort();
    const secondPort = new FakePort();
    pending[0]?.(firstPort);
    await expect(first).rejects.toBeInstanceOf(PdfOpenSupersededError);
    expect(firstPort.closed).toBe(true);
    pending[1]?.(secondPort);
    await settle();
    secondPort.reply({ id: secondPort.sent[0]?.id, kind: 'opened', pageCount: 1, pages: [A4] });
    expect(await second).toEqual({ pageCount: 1, pages: [A4] });
    expect(secondPort.closed).toBe(false);
  });

  test('closes the render page when the document is closed while it opens', async () => {
    const { host, pending } = createSlowHost();
    const opening = host.open(Uint8Array.of(1));
    host.close();
    const port = new FakePort();
    pending[0]?.(port);
    await expect(opening).rejects.toBeInstanceOf(PdfOpenSupersededError);
    expect(port.closed).toBe(true);
    expect(port.sent).toEqual([]);
  });
});
