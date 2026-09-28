import { defineConfig } from '@playwright/test';

/** 端到端测试：直接启动 electron-vite 构建出的 out/main/index.js（先运行 `bun run build`）。 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
});
