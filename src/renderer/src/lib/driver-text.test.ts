import { describe, expect, test } from 'bun:test';
import type { DriverDeviceView, DriverInstallView } from '../../../shared/drivers';
import {
  actionText,
  catalogText,
  deviceDetail,
  deviceTitle,
  emptyDevicesText,
  formatMegabytes,
  installText,
  stepProgress,
} from './driver-text';

/** 取 UTC 正午：任何时区下都是同一天。 */
const ISSUED = Date.UTC(2026, 8, 1, 12);
const EXPIRES = Date.UTC(2027, 2, 1, 12);

const DEVICE: DriverDeviceView = {
  key: 'usb-1234-abcd-00000001',
  name: '未知设备',
  usbId: '1234:ABCD',
  problem: 'no-driver',
  problemCode: 28,
  action: { kind: 'install', brand: '示例品牌', model: '示例型号 X1', sizeBytes: 12_900_000 },
};

function install(state: DriverInstallView['state']): DriverInstallView {
  return { id: 1, modelId: 'example-x1', deviceKey: DEVICE.key, brand: '示例品牌', model: '示例型号 X1', state };
}

describe('catalogText', () => {
  test('describes each catalog state', () => {
    expect(catalogText({ state: 'unconfigured' })).toMatchObject({
      tone: 'warning',
      text: expect.stringContaining('未配置驱动清单地址'),
    });
    expect(
      catalogText({ state: 'ready', issuedAt: ISSUED, expiresAt: EXPIRES, modelCount: 3, staleIssue: null }),
    ).toEqual({
      tone: 'ok',
      text: '驱动清单：2026-09-01 签发，3 个型号，有效期到 2027-03-01',
    });
    expect(
      catalogText({ state: 'ready', issuedAt: ISSUED, expiresAt: EXPIRES, modelCount: 3, staleIssue: '连不上' }).tone,
    ).toBe('warning');
    expect(catalogText({ state: 'failed', issue: '驱动清单的签名不对，可能被改过，不使用' })).toEqual({
      tone: 'error',
      text: '驱动清单不能用：驱动清单的签名不对，可能被改过，不使用',
    });
  });

  test('never suggests filling in an address when this build has no embedded keys', () => {
    const text = catalogText({ state: 'no-keys' });
    expect(text).toEqual({ tone: 'warning', text: '这个版本没有内置驱动清单公钥，不能自动安装驱动' });
    expect(text.text).not.toContain('驱动清单地址');
    expect(text.text).not.toContain('请更新程序');
  });
});

describe('devices', () => {
  test('names the device after the catalog model and shows the USB id and problem', () => {
    expect(deviceTitle(DEVICE)).toBe('示例品牌 示例型号 X1');
    expect(deviceTitle({ ...DEVICE, action: { kind: 'not-in-catalog' } })).toBe('未知设备');
    expect(deviceDetail(DEVICE)).toBe('USB 1234:ABCD · 没装驱动');
    expect(deviceDetail({ ...DEVICE, problem: 'driver-error', problemCode: 10 })).toBe(
      'USB 1234:ABCD · 驱动有问题（设备管理器代码 10）',
    );
  });

  test('offers an install button or guidance', () => {
    expect(actionText(DEVICE.action, 'windows')).toEqual({ button: '安装驱动（12.3 MB）', guide: null });
    expect(actionText({ kind: 'not-in-catalog' }, 'windows').guide).toContain('通用驱动');
    expect(actionText({ kind: 'no-catalog' }, 'mac').guide).toContain('厂家官网');
    expect(actionText({ kind: 'open-page', brand: '示例品牌', model: '示例型号 X1' }, 'mac').button).toBe(
      '打开官方下载页',
    );
  });

  test('says what an empty list means on each platform', () => {
    expect(emptyDevicesText('windows')).toBe('没有发现缺驱动的 USB 打印设备');
    expect(emptyDevicesText('mac')).toContain('清单里有的型号');
  });
});

describe('install progress', () => {
  test('shows download progress and the admin prompt hint', () => {
    expect(
      installText(
        install({ phase: 'running', step: 'downloading', receivedBytes: 1_048_576, totalBytes: 12_900_000 }),
        'windows',
      ),
    ).toEqual({
      tone: 'running',
      text: '正在下载示例品牌 示例型号 X1 的驱动：1.0 MB / 12.3 MB',
    });
    expect(
      installText(install({ phase: 'running', step: 'installing', receivedBytes: 0, totalBytes: 1 }), 'windows').text,
    ).toContain('点「是」');
    expect(
      installText(install({ phase: 'running', step: 'installing', receivedBytes: 0, totalBytes: 1 }), 'mac').text,
    ).toContain('密码');
  });

  test('names the new printer or says how to find it', () => {
    expect(
      installText(install({ phase: 'done', newPrinters: ['示例标签机'], needsRestart: false }), 'windows'),
    ).toEqual({
      tone: 'ok',
      text: '驱动已装好，新打印机：示例标签机。到上面「纸张 → 打印机」给它分配纸张',
    });
    expect(installText(install({ phase: 'done', newPrinters: [], needsRestart: true }), 'windows').text).toContain(
      '重启电脑',
    );
  });

  test('explains each failure with a next step', () => {
    expect(
      installText(install({ phase: 'failed', failure: 'hash-mismatch', exitCode: null }), 'windows'),
    ).toMatchObject({
      tone: 'error',
      text: expect.stringContaining('SHA-256'),
    });
    expect(
      installText(install({ phase: 'failed', failure: 'installer-failed', exitCode: 1603 }), 'windows').text,
    ).toContain('1603');
    expect(
      installText(install({ phase: 'failed', failure: 'admin-declined', exitCode: null }), 'windows').text,
    ).toContain('再点一次');
    expect(
      installText(install({ phase: 'failed', failure: 'signature-unverifiable', exitCode: null }), 'windows').text,
    ).toBe('核对签名失败，详情见日志');
  });

  test('marks the steps before, at and after the current one', () => {
    expect(stepProgress('downloading', 'installing')).toBe('done');
    expect(stepProgress('installing', 'installing')).toBe('current');
    expect(stepProgress('finding-printer', 'installing')).toBe('todo');
  });

  test('formats sizes in megabytes', () => {
    expect(formatMegabytes(524_288)).toBe('0.5 MB');
  });
});
