import { type ElectronApplication, expect, type Page } from '@playwright/test';
import { IpcChannel, type LabelFlashApi } from '../../src/shared/ipc-contract';

/** 工作台扫码框：填入内容再按回车。 */
export async function scan(page: Page, raw: string): Promise<void> {
  const input = page.locator('.scan-bar__input');
  await input.fill(raw);
  await input.press('Enter');
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
