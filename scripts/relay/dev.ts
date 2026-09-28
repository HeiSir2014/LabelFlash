/**
 * 本机调试中转服务：构建后在 http://localhost:3180 启动（浏览器把 localhost 当安全上下文，摄像头可用）。
 * 电脑端连 ws://localhost:3180/ws/desktop；手机扫码页在 http://localhost:3180/m/。
 */
import { join, resolve } from 'node:path';
import { DEFAULT_PORT } from '../../relay/src/config';
import { startRelay } from '../../relay/src/server';
import { buildRelay, relayVersion } from './build';

const ROOT = resolve(import.meta.dir, '../..');
const outDir = join(ROOT, 'relay', 'dist');
const version = await relayVersion();
await buildRelay({ outDir, version });

const relay = startRelay(
  {
    host: '127.0.0.1',
    port: DEFAULT_PORT,
    publicOrigin: `http://localhost:${DEFAULT_PORT}`,
    webRoot: join(outDir, 'web'),
    version,
  },
  (line) => console.log(`${new Date().toISOString()} ${line}`),
);
console.log(`扫码页：${new URL('/m/', relay.url).href}`);
