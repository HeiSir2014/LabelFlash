import { defineConfig } from '@playwright/test';

/**
 * 端到端测试：以项目根目录启动 Electron（按 package.json 的 main 找到 electron-vite 构建出的 out/main/index.js），
 * 这样 app.getVersion() 是软件版本。先构建再跑：`bun run test:e2e` 会自动构建。
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
});
