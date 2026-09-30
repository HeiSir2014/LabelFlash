/**
 * 更新后重启时新版本的窗口该去哪：旧版本装更新之前写下，新版本启动时读一次就删。
 * - front：操作员点了「重启更新」，新版本窗口到最前、拿到焦点，接着就能扫码；
 * - tray：窗口关在托盘里时静默更新的，新版本也待在托盘里，不弹窗口打扰人。
 *
 * 用同步读写：写在退出前的最后一步，读在建窗口之前。不 import electron，用 bun test 测试。
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type RelaunchWindow = 'front' | 'tray';

/** 安装程序装完更新后启动新版本时带的参数（electron-builder 安装脚本的 StartApp）：只有带着它才按意图行事。 */
export const UPDATED_ARG = '--updated';

export const RELAUNCH_INTENT_FILE_NAME = 'relaunch.json';
/** 静默安装加启动新版本通常十几秒；过了这么久还没被读到，说明安装没成功重启，这条作废。 */
export const RELAUNCH_INTENT_TTL_MS = 10 * 60_000;

const WINDOWS: readonly RelaunchWindow[] = ['front', 'tray'];

export class RelaunchIntents {
  private readonly file: string;

  constructor(
    dir: string,
    private readonly now: () => number,
  ) {
    this.file = join(dir, RELAUNCH_INTENT_FILE_NAME);
  }

  write(window: RelaunchWindow): void {
    writeFileSync(this.file, JSON.stringify({ window, at: this.now() }));
  }

  /** 读出并删除；没有、过期或内容不对时返回 null。 */
  consume(): RelaunchWindow | null {
    let text: string;
    try {
      text = readFileSync(this.file, 'utf8');
    } catch {
      return null;
    }
    rmSync(this.file, { force: true });
    try {
      const { window, at } = JSON.parse(text) as { window?: unknown; at?: unknown };
      const isFresh = typeof at === 'number' && this.now() - at <= RELAUNCH_INTENT_TTL_MS;
      return isFresh && WINDOWS.includes(window as RelaunchWindow) ? (window as RelaunchWindow) : null;
    } catch {
      return null;
    }
  }
}
