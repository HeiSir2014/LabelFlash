import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, _electron as electron, expect, type Page } from '@playwright/test';
import { API_PORT_ENV } from '../../src/main/api/local-api';
import {
  DRIVER_CATALOG_TEST_KEY_ENV,
  FAKE_DRIVERS_ENV,
  type FakeDriverSpec,
} from '../../src/main/drivers/fake-drivers';
import { FAKE_OCR_ENV } from '../../src/main/ocr/fake-ocr';
import { FAKE_PRINTERS_ENV, type FakePrinterSpec } from '../../src/main/printing/fake-printers';

/**
 * 以项目根目录启动：Electron 读 package.json 的 main 找到构建产物，app.getVersion() 才是软件版本。
 * 直接传 out/main/index.js 时找不到 package.json，拿到的是 Electron 自己的版本号。
 */
export const APP_ROOT = join(__dirname, '..', '..');
/** 与 src/main/index.ts 中的 USER_DATA_OVERRIDE_ENV 一致：只在未打包时生效。 */
const USER_DATA_ENV = 'CDL_LABELFLASH_USER_DATA';
/**
 * macOS 上 safeStorage 默认读写登录钥匙串里的「<应用名> Safe Storage」：这一项在临时数据目录之外，
 * 测试结束也不会删，还可能弹授权框。改用 Chromium 的模拟钥匙串，只在这次运行里有效。
 */
const MAC_TEST_ARGS: readonly string[] = ['--use-mock-keychain'];
/** Windows 上 SQLite 关掉连接后还会占用文件一小会儿（oven-sh/bun#40001）：删除数据目录时重试几次。 */
const REMOVE_RETRIES = 5;
const REMOVE_RETRY_DELAY_MS = 200;

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  userData: string;
  /** 关掉程序并删掉这次的数据目录。 */
  close: () => Promise<void>;
}

export async function createUserDataDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'cdl-labelflash-e2e-'));
}

export async function removeUserDataDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true, maxRetries: REMOVE_RETRIES, retryDelay: REMOVE_RETRY_DELAY_MS });
}

export interface LaunchOptions {
  /** 用假打印机代替系统打印机（见 src/main/printing/fake-printers.ts）：打印只记下来，不碰真打印机。 */
  fakePrinters?: FakePrinterSpec[];
  /** 用假的文字识别：每张标签图都读出这几段字（见 src/main/ocr/fake-ocr.ts）。 */
  fakeOcr?: string[];
  /** 假的驱动环境（见 src/main/drivers/fake-drivers.ts）：缺驱动的设备、安装包下载、签名核对和提权安装都是假的。 */
  fakeDrivers?: FakeDriverSpec;
  /** 额外信任的驱动清单公钥（编号 e2e）：E2E 用现场生成的密钥签清单。 */
  driverCatalogKey?: string;
}

/** 用指定的数据目录（不传则新建一个）启动构建好的程序，等到扫码框出现。 */
export async function launchApp(userData?: string, options: LaunchOptions = {}): Promise<LaunchedApp> {
  const dataDir = userData ?? (await createUserDataDir());
  // 不带 ELECTRON_RENDERER_URL：界面必须走 app:// 协议，和安装版一致。
  const env: Record<string, string> = { [USER_DATA_ENV]: dataDir };
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RENDERER_URL') {
      env[key] = value;
    }
  }
  if (options.fakePrinters) {
    env[FAKE_PRINTERS_ENV] = JSON.stringify(options.fakePrinters);
  }
  if (options.fakeOcr) {
    env[FAKE_OCR_ENV] = JSON.stringify(options.fakeOcr);
  }
  if (options.fakeDrivers) {
    env[FAKE_DRIVERS_ENV] = JSON.stringify(options.fakeDrivers);
  }
  if (options.driverCatalogKey) {
    env[DRIVER_CATALOG_TEST_KEY_ENV] = options.driverCatalogKey;
  }
  // 本机接口用系统随便给的端口：并行的用例之间、和本机上跑着的安装版之间都不抢 17631。
  env[API_PORT_ENV] = '0';
  const platformArgs = process.platform === 'darwin' ? MAC_TEST_ARGS : [];
  const app = await electron.launch({ args: [APP_ROOT, ...platformArgs], env });
  let page: Page;
  try {
    page = await app.firstWindow();
    await expect(page.locator('.scan-bar__input')).toBeVisible();
  } catch (error) {
    // 调用方还没拿到这个程序，没法关它：启动没完成就在这里关掉，免得残留的进程占着数据目录。
    await app.close().catch(() => undefined);
    throw error;
  }
  return {
    app,
    page,
    userData: dataDir,
    close: async () => {
      try {
        await app.close();
      } finally {
        await removeUserDataDir(dataDir);
      }
    },
  };
}
