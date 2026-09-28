import { test as base, type ElectronApplication } from '@playwright/test';
import { createUserDataDir, type LaunchedApp, launchApp, removeUserDataDir } from './electron-app';

/** 一个用例的程序：同一个数据目录可以多次启动（例如验证重启后设置还在）。 */
export interface AppLauncher {
  userData: string;
  launch: () => Promise<LaunchedApp>;
}

/**
 * 用例结束时（包括失败时）先关掉这个用例启动过的所有程序，再删数据目录：
 * 程序还开着就删目录，Windows 上会因为 SQLite 占用文件而失败，还会盖住原本的失败信息。
 */
export const test = base.extend<{ electronApp: AppLauncher }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright 按第一个参数的解构判断夹具依赖，这个夹具不依赖别的夹具。
  electronApp: async ({}, use) => {
    const userData = await createUserDataDir();
    const started: ElectronApplication[] = [];
    try {
      await use({
        userData,
        launch: async () => {
          const launched = await launchApp(userData);
          started.push(launched.app);
          return launched;
        },
      });
    } finally {
      for (const app of started) {
        // 用例里已经关掉的程序再关一次会报错，忽略即可。
        await app.close().catch(() => undefined);
      }
      await removeUserDataDir(userData);
    }
  },
});

export { expect } from '@playwright/test';
