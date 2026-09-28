import { describe, expect, test } from 'bun:test';
import { MAX_DEVICE_LENGTH } from '../../../src/shared/mobile-protocol';
import { deviceLabel } from './device-label';

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphoneWeChat:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.60(0x18003c2f) NetType/WIFI Language/zh_CN',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  androidWeChat:
    'Mozilla/5.0 (Linux; Android 14; V2309A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.103 Mobile Safari/537.36 XWEB/1300259 MMWEBSDK/20241103 MicroMessenger/8.0.55.2780(0x28003737) WeChat/arm64 Weixin NetType/WIFI Language/zh_CN',
  ipadSafari:
    'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.101 Mobile/15E148 Safari/604.1',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
};

describe('deviceLabel', () => {
  test('names the phone and the app it runs in', () => {
    expect(deviceLabel(UA.iphoneSafari)).toBe('iPhone · Safari');
    expect(deviceLabel(UA.iphoneWeChat)).toBe('iPhone · 微信');
    expect(deviceLabel(UA.androidChrome)).toBe('安卓 · Chrome');
    expect(deviceLabel(UA.androidWeChat)).toBe('安卓 · 微信');
    expect(deviceLabel(UA.ipadSafari)).toBe('iPad · Safari');
    expect(deviceLabel(UA.iphoneChrome)).toBe('iPhone · Chrome');
    expect(deviceLabel(UA.windowsEdge)).toBe('电脑 · Edge');
  });

  test('falls back to a generic name', () => {
    expect(deviceLabel('')).toBe('手机浏览器');
  });

  test('stays within the length the desktop accepts', () => {
    for (const ua of Object.values(UA)) {
      expect(deviceLabel(ua).length).toBeLessThanOrEqual(MAX_DEVICE_LENGTH);
    }
  });
});
