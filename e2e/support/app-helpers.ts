import { type ElectronApplication, expect, type Page } from '@playwright/test';
import type { FakePrint } from '../../src/main/printing/fake-printers';
import { IpcChannel, type LabelFlashApi } from '../../src/shared/ipc-contract';
import { SCAN_LINE_GAP_RANGE } from '../../src/shared/settings';

/** 工作台扫码框：填入内容再按回车。 */
export async function scan(page: Page, raw: string): Promise<void> {
  const input = page.locator('.scan-bar__input');
  await input.fill(raw);
  await input.press('Enter');
}

/**
 * 多行扫码的用例先调它：把「码里的换行」和「扫完了」的分界（scanLineGapMs）调到最大。
 * typeLikeScanner 每打一行、按一次回车都要和 Playwright 来回一趟，CI 机器忙时回车后的停顿会超过默认的 80ms，
 * 一张多行码就被拆成几张（2026-10-01 macOS CI 出现过）；真扫码枪的回车后面紧跟着下一个字，不受影响。
 */
export async function allowSlowScannerLines(page: Page): Promise<void> {
  await callApi(page, 'updateSettings', { scanLineGapMs: SCAN_LINE_GAP_RANGE.max });
  await page.reload();
  await expect(page.locator('.scan-bar__input')).toBeFocused();
}

/** 像扫码枪一样逐行打字、每行回车：焦点不在输入框时由程序决定字符落在哪里。 */
export async function typeLikeScanner(page: Page, lines: readonly string[]): Promise<void> {
  for (const line of lines) {
    await page.keyboard.type(line);
    await page.keyboard.press('Enter');
  }
}

/** 打开配置中心的某一页。正在淡出（inert）的配置中心不算打开，要重新打开。 */
export async function openConfig(page: Page, pageName: string): Promise<void> {
  if ((await page.locator('.config-center:not(.config-center--leaving)').count()) === 0) {
    await page.getByRole('button', { name: '配置', exact: true }).click();
  }
  await page.getByRole('navigation', { name: '配置' }).getByRole('button', { name: pageName, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(pageName);
}

/** 让焦点离开输入框，落到页面上（不点任何位置：版面变了也不会误点到控件）。 */
export async function blurActiveElement(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
}

/** 调用界面上的 window.api（和界面走同一条 IPC）。 */
export async function callApi<K extends keyof LabelFlashApi>(
  page: Page,
  method: K,
  ...args: Parameters<LabelFlashApi[K]>
): Promise<Awaited<ReturnType<LabelFlashApi[K]>>> {
  return page.evaluate(
    ({ name, params }) => {
      const api = (window as unknown as { api: Record<string, (...values: unknown[]) => Promise<unknown>> }).api;
      const method = api[name];
      if (!method) {
        throw new Error(`window.api.${name} does not exist`);
      }
      return method(...params);
    },
    { name: method, params: args as unknown[] },
  ) as Promise<Awaited<ReturnType<LabelFlashApi[K]>>>;
}

/** 假打印机收到的打印（启动时带 fakePrinters，见 src/main/printing/fake-printers.ts）。 */
export function fakePrints(app: ElectronApplication): Promise<FakePrint[]> {
  return app.evaluate(
    () => (globalThis as { e2eFakePrinters?: { printed: FakePrint[] } }).e2eFakePrinters?.printed ?? [],
  );
}

/**
 * 模拟 1.0.x 留下的设置：只有「选中的打印机」（selectedPrinter），还没有纸张分配。
 * 借运行中程序的主进程另开一个数据库连接来写（WAL 模式下可以同时开）；Playwright 所在的运行时不一定带 node:sqlite。
 * 调用方随后关掉程序，再用同一个数据目录启动。
 */
export async function seedLegacySelectedPrinter(app: ElectronApplication, printerName: string): Promise<void> {
  await app.evaluate(({ app: electronApp }, name) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const { join } = process.getBuiltinModule('node:path');
    const db = new DatabaseSync(join(electronApp.getPath('userData'), 'labelflash.db'));
    try {
      db.exec("DELETE FROM settings WHERE key = 'paperPrinters'");
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('selectedPrinter', ?)").run(
        JSON.stringify(name),
      );
    } finally {
      db.close();
    }
  }, printerName);
}

/** 换掉主进程的打印处理：只计数，不碰真实打印机。返回读取打印次数的函数。 */
export async function stubPrinting(app: ElectronApplication): Promise<() => Promise<number>> {
  await app.evaluate(({ ipcMain }, channel) => {
    const calls = { count: 0 };
    (globalThis as { e2ePrintCalls?: typeof calls }).e2ePrintCalls = calls;
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, () => {
      calls.count += 1;
      return { status: 'failed', reason: 'PRINT_ERROR' };
    });
  }, IpcChannel.Print);
  return () => app.evaluate(() => (globalThis as { e2ePrintCalls?: { count: number } }).e2ePrintCalls?.count ?? -1);
}

/** 换掉主进程的语音合成：只记下要播的播报语，不合成、不出声（界面随后改用提示音）。返回读取记录的函数。 */
export async function recordVoiceCues(app: ElectronApplication): Promise<() => Promise<string[]>> {
  await app.evaluate(({ ipcMain }, channel) => {
    const cues: string[] = [];
    (globalThis as { e2eVoiceCues?: string[] }).e2eVoiceCues = cues;
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (_event, cue: string) => {
      cues.push(cue);
      return null;
    });
  }, IpcChannel.VoiceClip);
  return () => app.evaluate(() => [...((globalThis as { e2eVoiceCues?: string[] }).e2eVoiceCues ?? [])]);
}

/** 换掉系统的打开文件对话框：直接选中 path。 */
export async function stubOpenDialog(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [filePath] })) as typeof dialog.showOpenDialog;
  }, path);
}

/** 换掉剪贴板写入：记下写入的内容，不碰系统剪贴板。返回读取记录的函数。 */
export async function recordClipboard(app: ElectronApplication): Promise<() => Promise<string[]>> {
  await app.evaluate(({ clipboard }) => {
    const copied: string[] = [];
    (globalThis as { e2eCopied?: string[] }).e2eCopied = copied;
    clipboard.writeText = async (text: string) => {
      copied.push(text);
    };
  });
  return () => app.evaluate(() => [...((globalThis as { e2eCopied?: string[] }).e2eCopied ?? [])]);
}

/**
 * 用这台电脑的系统字体真实渲染一份标签 HTML，列出被框边缘裁掉的行：测试自己开一个能跑脚本的隐藏窗口来量
 * （打印窗口禁用了脚本），用 Range 量文字本身的宽度（带小数），比这一行的可用宽度宽就是被裁掉了。
 * 每项写出文字、两者的宽度和字号，方便对照字宽表。
 */
export function clippedLines(app: ElectronApplication, html: string): Promise<string[]> {
  return app.evaluate(async ({ BrowserWindow }, source) => {
    const window = new BrowserWindow({ show: false });
    try {
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(source)}`);
      return (await window.webContents.executeJavaScript(
        `[...document.querySelectorAll('.line, .code__text')].flatMap((line) => {
          const range = document.createRange();
          range.selectNodeContents(line);
          const text = range.getBoundingClientRect().width;
          const box = line.getBoundingClientRect().width;
          return text > box + 0.5
            ? [line.textContent + ' | 文字 ' + text.toFixed(2) + 'px | 可用 ' + box.toFixed(2) + 'px | 字号 ' + getComputedStyle(line).fontSize]
            : [];
        })`,
      )) as string[];
    } finally {
      window.destroy();
    }
  }, html);
}
