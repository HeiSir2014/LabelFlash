import { randomUUID } from 'node:crypto';

/**
 * 标签 HTML 的一次性内存存储：label-window.ts 用它代替 data: URL 加载 HTML。
 * Chromium 对 data: URL 有大小限制（实测约 1.9MB 就 ERR_FAILED），自由设计模板里内嵌的图片
 * 转成 1 位 BMP 后按打印机（或 PDF_DPI=1200）的点数线性增长，100×100 的标签配一张铺满的图片
 * 就能到 3MB 以上，稳定超过这个限制。
 *
 * 不写磁盘：HTML 只存在这个进程的内存里，按随机 token 取一次就忘，不跨窗口共享、不留痕迹。
 */
export class LabelRenderStore {
  private readonly pending = new Map<string, string>();

  /** 存入 HTML，返回只能取一次的 token。 */
  put(html: string): string {
    const token = randomUUID();
    this.pending.set(token, html);
    return token;
  }

  /** 取出并立刻忘记；token 不存在或已经取过，返回 undefined。 */
  take(token: string): string | undefined {
    const html = this.pending.get(token);
    this.pending.delete(token);
    return html;
  }
}
