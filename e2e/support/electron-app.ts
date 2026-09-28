import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, _electron as electron, expect, type Page } from '@playwright/test';

/**
 * 以项目根目录启动：Electron 读 package.json 的 main 找到构建产物，app.getVersion() 才是软件版本。
 * 直接传 out/main/index.js 时找不到 package.json，拿到的是 Electron 自己的版本号。
 */
export const APP_ROOT = join(__dirname, '..', '..');
/** 与 src/main/index.ts 中的 USER_DATA_OVERRIDE_ENV 一致：只在未打包时生效。 */
const USER_DATA_ENV = 'CDL_LABELFLASH_USER_DATA';

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  userData: string;
  /** 关掉程序并删掉这次的数据目录。 */
  close: () => Promise<void>;
}

/** 用一个全新的数据目录启动构建好的程序，等到扫码框出现。 */
export async function launchApp(userData?: string): Promise<LaunchedApp> {
  const dataDir = userData ?? (await mkdtemp(join(tmpdir(), 'cdl-labelflash-e2e-')));
  // 不带 ELECTRON_RENDERER_URL：界面必须走 app:// 协议，和安装版一致。
  const env: Record<string, string> = { [USER_DATA_ENV]: dataDir };
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RENDERER_URL') {
      env[key] = value;
    }
  }
  const app = await electron.launch({ args: [APP_ROOT], env });
  const page = await app.firstWindow();
  await expect(page.locator('.scan-bar__input')).toBeVisible();
  return {
    app,
    page,
    userData: dataDir,
    close: async () => {
      await app.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
