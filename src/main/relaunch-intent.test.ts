import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RELAUNCH_INTENT_FILE_NAME, RELAUNCH_INTENT_TTL_MS, RelaunchIntents } from './relaunch-intent';

describe('RelaunchIntents', () => {
  let dir: string;
  let now: number;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cdl-relaunch-'));
    now = 1_000_000;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const intents = () => new RelaunchIntents(dir, () => now);

  // 点「重启更新」的回到前台；关到托盘后静默更新的，新版本也待在托盘里。
  test('tells the new version where its window should go, once', () => {
    intents().write('tray');
    const next = intents();
    expect(next.consume()).toBe('tray');
    expect(next.consume()).toBeNull();
  });

  test('removes the file it read', async () => {
    intents().write('front');
    intents().consume();
    expect(await readdir(dir)).toEqual([]);
  });

  // 安装失败、没有重启：下次手动打开时这条早就过时了，不能让窗口莫名其妙藏在托盘里。
  test('ignores an intent written long ago', () => {
    intents().write('tray');
    now += RELAUNCH_INTENT_TTL_MS + 1;
    expect(intents().consume()).toBeNull();
  });

  test('ignores a missing or damaged file', async () => {
    expect(intents().consume()).toBeNull();
    await writeFile(join(dir, RELAUNCH_INTENT_FILE_NAME), '{"window":"elsewhere"');
    expect(intents().consume()).toBeNull();
    await writeFile(join(dir, RELAUNCH_INTENT_FILE_NAME), JSON.stringify({ window: 'elsewhere', at: now }));
    expect(intents().consume()).toBeNull();
  });
});
