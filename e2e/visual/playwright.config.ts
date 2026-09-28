import { defineConfig } from '@playwright/test';

/**
 * 视觉验收（设计文档 §8）：按验收项截图、跑自动检查，结果写到 test-results/visual-acceptance/。
 * 本地运行，先构建：`bun run build && bunx playwright test --config e2e/visual/playwright.config.ts`。
 * 日常的 `bun run test:e2e` 不跑这里的 *.visual.ts，只跑同目录的 checks.e2e.ts（检查本身的回归）。
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.visual.ts',
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
  outputDir: '../../test-results/visual-run',
});
