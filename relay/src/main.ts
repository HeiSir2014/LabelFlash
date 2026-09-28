/**
 * 中转服务入口（容器里以 `bun /app/server.js` 运行）。配置见 config.ts，版本号由构建脚本注入。
 */
import { readConfig } from './config';
import { startRelay } from './server';

declare const RELAY_VERSION: string | undefined;

const version = typeof RELAY_VERSION === 'string' ? RELAY_VERSION : 'dev';
const relay = startRelay(readConfig(process.env, import.meta.dir, version), (line) => {
  console.log(`${new Date().toISOString()} ${line}`);
});

// docker stop 发 SIGTERM：先关掉监听和现有连接再退出，电脑和手机会自动重连到新容器。
process.on('SIGTERM', () => {
  void relay.stop().then(() => process.exit(0));
});
