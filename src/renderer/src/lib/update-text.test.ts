import { describe, expect, test } from 'bun:test';
import { describeUpdate } from './update-text';

describe('describeUpdate', () => {
  test('development builds never check', () => {
    expect(describeUpdate({ state: 'disabled', reason: 'development' })).toEqual({
      text: '开发版不检查更新',
      canCheck: false,
      isReady: false,
    });
  });

  test('tells macOS users to download new versions themselves', () => {
    expect(describeUpdate({ state: 'disabled', reason: 'unsupported-platform' })).toEqual({
      text: '这个平台暂不支持自动更新，新版本请到发布页下载安装',
      canCheck: false,
      isReady: false,
    });
  });

  test('only idle, up-to-date and error states allow a manual check', () => {
    expect(describeUpdate({ state: 'idle' }).canCheck).toBe(true);
    expect(describeUpdate({ state: 'up-to-date', checkedAt: Date.now() }).canCheck).toBe(true);
    expect(describeUpdate({ state: 'error' }).canCheck).toBe(true);
    expect(describeUpdate({ state: 'checking' }).canCheck).toBe(false);
    expect(describeUpdate({ state: 'downloading', version: '0.2.0', percent: 40 }).canCheck).toBe(false);
  });

  test('shows download progress and the ready version', () => {
    expect(describeUpdate({ state: 'downloading', version: '0.2.0', percent: 40 }).text).toBe(
      '正在下载新版本 0.2.0（40%）',
    );
    expect(describeUpdate({ state: 'ready', version: '0.2.0' })).toEqual({
      text: '新版本 0.2.0 已下载，重启后生效',
      canCheck: false,
      isReady: true,
    });
  });
});
