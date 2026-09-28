import { join } from 'node:path';

export interface RelayConfig {
  /** 容器里监听所有地址；部署时只把端口映射到宿主机的 127.0.0.1，由反向代理对外。 */
  host: string;
  port: number;
  /**
   * 扫码页对外的 origin（例如 https://relay.example.com）。
   * 手机连接的 Origin 必须是它，CSP 的 connect-src 也按它写。部署的人必须设置，代码里没有默认值。
   */
  publicOrigin: string;
  /** 扫码页的构建产物目录。 */
  webRoot: string;
  version: string;
}

export const DEFAULT_PORT = 3180;
const DEFAULT_HOST = '0.0.0.0';
const MAX_PORT = 65_535;
/** 开发时在本机用 http 访问（浏览器把 localhost 视为安全上下文，摄像头可用）。 */
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1']);

export function readConfig(env: Record<string, string | undefined>, entryDir: string, version: string): RelayConfig {
  return {
    host: env['HOST'] ?? DEFAULT_HOST,
    port: readPort(env['PORT']),
    publicOrigin: readOrigin(env['PUBLIC_ORIGIN']),
    webRoot: join(entryDir, 'web'),
    version,
  };
}

function readPort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    throw new Error(`PORT 必须是 1–${MAX_PORT} 的整数，现在是「${value}」`);
  }
  return port;
}

function readOrigin(value: string | undefined): string {
  if (value === undefined || value === '') {
    throw new Error('必须设置 PUBLIC_ORIGIN：扫码页对外的 https origin，例如 https://relay.example.com');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`PUBLIC_ORIGIN 不是合法的地址：「${value}」`);
  }
  const isSecure = url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTNAMES.has(url.hostname));
  if (!isSecure || url.origin !== value) {
    throw new Error(`PUBLIC_ORIGIN 必须是 https 的 origin（不含路径），本机开发可用 http://localhost：「${value}」`);
  }
  return url.origin;
}
