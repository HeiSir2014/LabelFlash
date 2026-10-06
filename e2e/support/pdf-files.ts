import { writeFile } from 'node:fs/promises';
import type { ElectronApplication } from '@playwright/test';

/**
 * A4 上 2×2 四张「面单」（1mm 黑框 + 一个大字母），两页，之间留 10mm 空白：和平台导出的四联面单一样是矢量 PDF。
 * 页高留 1mm 余量，避免取整多出一页白纸。
 */
const GRID_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
@page { size: A4; margin: 0; }
* { box-sizing: border-box; margin: 0; }
.page { display: grid; grid-template-columns: 95mm 95mm; grid-template-rows: 138mm 138mm; gap: 10mm;
  width: 210mm; height: 296mm; padding: 5mm; overflow: hidden; }
.page + .page { break-before: page; }
.label { display: flex; align-items: center; justify-content: center; border: 1mm solid #000; font: bold 60mm sans-serif; }
</style></head><body>
<div class="page"><div class="label">A</div><div class="label">B</div><div class="label">C</div><div class="label">D</div></div>
<div class="page"><div class="label">E</div><div class="label">F</div><div class="label">G</div><div class="label">H</div></div>
</body></html>`;

/** 用被测程序自己的 Electron（printToPDF）生成 2×2 面单的 PDF。 */
export async function gridPdfBytes(app: ElectronApplication): Promise<Buffer> {
  const base64 = await app.evaluate(async ({ BrowserWindow }, html) => {
    const window = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
    try {
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const pdf = await window.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      });
      return pdf.toString('base64');
    } finally {
      window.destroy();
    }
  }, GRID_HTML);
  return Buffer.from(base64, 'base64');
}

/** 一张 60×40mm 的标签 PDF（中间一行粗体字），用被测程序自己的 printToPDF 生成。 */
export async function labelPdfBytes(app: ElectronApplication, text: string): Promise<Buffer> {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: 60mm 40mm; margin: 0; }
body { margin: 0; }
.label { width: 60mm; height: 40mm; display: flex; align-items: center; justify-content: center; font: bold 12mm sans-serif; }
</style></head><body><div class="label">${text}</div></body></html>`;
  const base64 = await app.evaluate(async ({ BrowserWindow }, page) => {
    const window = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
    try {
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
      const pdf = await window.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      });
      return pdf.toString('base64');
    } finally {
      window.destroy();
    }
  }, html);
  return Buffer.from(base64, 'base64');
}

export async function writeGridPdf(app: ElectronApplication, path: string): Promise<void> {
  await writeFile(path, await gridPdfBytes(app));
}
