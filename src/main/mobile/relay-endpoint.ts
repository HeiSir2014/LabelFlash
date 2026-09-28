/**
 * 中转服务的地址：设置优先，构建时注入的默认值兜底；拼出电脑端的 WebSocket 地址。
 * 地址本身的校验规则在 src/shared/relay-url.ts（设置也用它）。
 */
import { sanitizeRelayUrl } from '../../shared/relay-url';

/** 设置优先，构建默认值兜底；都没有（或不合法）时为 null，界面提示去配置中心填写。 */
export function resolveRelayBase(sources: { setting: string | null; buildDefault: string | null }): URL | null {
  const href = sanitizeRelayUrl(sources.setting) ?? sanitizeRelayUrl(sources.buildDefault);
  return href === null ? null : new URL(href);
}

export function desktopSocketUrl(base: URL): string {
  const url = new URL('ws/desktop', base);
  url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}
