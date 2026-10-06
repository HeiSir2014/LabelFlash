import type { SharedPrinter } from '../../core/ipp/shared-printer';

/** 浏览器打开打印机网址（printer-more-info、DNS-SD 的 adminurl）时看到的说明页：纯文字，没有脚本。 */

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** 名字、电脑名都来自外部：放进页面前一律转义。 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body style="font-family:sans-serif;margin:2em;line-height:1.6">${body}</body></html>`;
}

/** 一台共享打印机：名字、在哪台电脑上、现在的状态，和怎么添加。 */
export function printerPage(printer: SharedPrinter): string {
  return page(
    printer.name,
    [
      `<h1>${escapeHtml(printer.name)}</h1>`,
      `<p>${escapeHtml(printer.location)} 上共享的热敏标签机，打印到「${escapeHtml(printer.name)}」这种纸。</p>`,
      `<p>状态：${escapeHtml(printer.state.message)}</p>`,
      '<p>在 Windows 的「添加打印机」里选「按名称选择共享打印机」，填这一页的网址；macOS 在「打印机与扫描仪」里会自动找到它。</p>',
    ].join(''),
  );
}

/** 这台电脑共享的全部打印机。 */
export function printerListPage(printers: readonly SharedPrinter[]): string {
  const items = printers
    .map((printer) => `<li><a href="/printers/${escapeHtml(printer.key)}">${escapeHtml(printer.name)}</a></li>`)
    .join('');
  return page('共享的热敏标签机', `<h1>共享的热敏标签机</h1><ul>${items}</ul>`);
}
