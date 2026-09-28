/**
 * 电脑上显示「哪部手机连着」：从 UA 得出一个简短描述，例如「iPhone · 微信」。
 * 只用于显示，不参与任何判断（UA 可以随便改）。
 */
const DEVICES: [RegExp, string][] = [
  [/iPad/, 'iPad'],
  [/iPhone/, 'iPhone'],
  [/Android/, '安卓'],
  [/Windows NT|Macintosh|X11/, '电脑'],
];

/** 顺序有讲究：内置浏览器的 UA 里也有 Chrome / Safari 字样，先认内置浏览器。 */
const BROWSERS: [RegExp, string][] = [
  [/MicroMessenger/, '微信'],
  [/AlipayClient/, '支付宝'],
  [/MQQBrowser|QQ\//, 'QQ'],
  [/EdgA|EdgiOS|Edg\//, 'Edge'],
  [/CriOS|Chrome\//, 'Chrome'],
  [/FxiOS|Firefox\//, 'Firefox'],
  [/Safari\//, 'Safari'],
];

const UNKNOWN = '手机浏览器';

export function deviceLabel(userAgent: string): string {
  const device = DEVICES.find(([pattern]) => pattern.test(userAgent))?.[1];
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (!device && !browser) {
    return UNKNOWN;
  }
  return [device ?? '手机', browser ?? '浏览器'].join(' · ');
}
