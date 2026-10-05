import type { Page } from '@playwright/test';
import { TEMPLATE_LIBRARY } from '../src/core/templates/library/template-library';
import type { FakePrinterSpec } from '../src/main/printing/fake-printers';
import { callApi, clippedLines, fakePrints, openConfig, scan } from './support/app-helpers';
import { expect, test } from './support/fixtures';

/** 装 50×30 的假标签机：「简洁吊牌」的纸。 */
const TAG_PRINTER: FakePrinterSpec = {
  name: '标签机A',
  paper: { widthMm: 50, heightMm: 30, dpi: 203 },
  readiness: { ready: true },
};
/** 装 40×30 的假标签机：「简洁价签」的纸。 */
const PRICE_PRINTER: FakePrinterSpec = {
  name: '标签机B',
  paper: { widthMm: 40, heightMm: 30, dpi: 203 },
  readiness: { ready: true },
};

async function assignPrinter(page: Page, printer: FakePrinterSpec): Promise<void> {
  const key = `${printer.paper?.widthMm}x${printer.paper?.heightMm}`;
  await callApi(page, 'updateSettings', { paperPrinters: { [key]: printer.name } });
  await page.reload();
  await expect(page.locator('.scan-bar__input')).toBeFocused();
}

async function openLibrary(page: Page) {
  await openConfig(page, '模板');
  await page.getByRole('button', { name: '从模板库新建' }).click();
  const library = page.getByRole('region', { name: '模板库' });
  await expect(library.getByRole('article')).toHaveCount(TEMPLATE_LIBRARY.length);
  return library;
}

// 从模板库新建：挑 50×30 的「简洁吊牌」，复制成自定义模板进设计器（示例数据预览），设为当前模板后扫码，打到装 50×30 的标签机。
test('creates a template from the library and prints scans with it', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({ fakePrinters: [TAG_PRINTER] });
  await assignPrinter(page, TAG_PRINTER);
  const library = await openLibrary(page);
  await page
    .getByRole('navigation', { name: '模板库分类' })
    .getByRole('button', { name: /^服装吊牌/ })
    .click();
  await library.getByLabel('纸张').selectOption('50x30');
  await expect(library.getByRole('article')).toHaveCount(1);
  const card = library.getByRole('article', { name: '简洁吊牌', exact: true });
  // 缩略图就是打印的 HTML：示例数据里的编码和 Code128 都在。
  const thumbnail = card.frameLocator('iframe');
  await expect(thumbnail.locator('.line', { hasText: 'CL5640-TK' }).first()).toBeVisible();
  await expect(thumbnail.locator('svg[shape-rendering="crispEdges"]')).toHaveCount(1);
  await card.getByRole('button', { name: '用这个模板' }).click();

  await expect(page.getByRole('region', { name: '设计器' })).toBeVisible();
  await expect(page.getByLabel('预览内容 · 示例数据')).toHaveValue('CL5640-TK-图片色-XL');
  await expect(page.getByRole('region', { name: '打印前检查' })).toContainText('没有发现问题');

  // 只多了一个自定义模板；模板库的模板不进模板列表。
  const templates = await callApi(page, 'listTemplates');
  const copies = templates.filter((template) => template.name === '简洁吊牌');
  expect(copies.map((template) => template.id)).toEqual([expect.stringMatching(/^custom:/)]);
  expect(templates.some((template) => template.id.startsWith('library:'))).toBe(false);

  await page.getByRole('button', { name: '返回列表' }).click();
  await expect(page.locator('.template-item', { hasText: '简洁吊牌' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '使用', exact: true }).click();
  await page.getByRole('button', { name: '返回工作台' }).click();
  await scan(page, 'CL5640-TK-图片色-XL');
  await expect
    .poll(() => fakePrints(app))
    .toEqual([{ printerName: '标签机A', raw: 'CL5640-TK-图片色-XL', paper: '50x30', templateId: copies[0]?.id }]);
});

// 复制出的价签在设计器里「打印一张试试」：打的是示例数据（完整内容是示例的商品码），不是最近一次扫码。
test('sample-prints a copied library template with its sample data', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch({ fakePrinters: [PRICE_PRINTER] });
  await assignPrinter(page, PRICE_PRINTER);
  await scan(page, 'CL5640-TK-图片色-XL');
  const library = await openLibrary(page);
  await library
    .getByRole('article', { name: '简洁价签', exact: true })
    .getByRole('button', { name: '用这个模板' })
    .click();
  const label = page.getByRole('main', { name: '模板' }).frameLocator('.label-frame');
  await expect(label.locator('.line', { hasText: '¥12.80' })).toBeVisible();
  await page.getByRole('button', { name: '打印一张试试' }).click();
  await expect
    .poll(() => fakePrints(app))
    .toEqual([{ printerName: '标签机B', raw: '6901234567892', paper: '40x30', templateId: 'custom:draft' }]);

  // 改了预览内容：回到按内容识别，标签旁不再写「示例数据」。
  await page.getByLabel('预览内容 · 示例数据').fill('CL5640-TK-图片色-XL');
  await expect(page.getByLabel('预览内容', { exact: true })).toBeVisible();
});

test('returns from the library to the template list with Esc', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  const library = await openLibrary(page);
  await page.keyboard.press('Escape');
  await expect(library).toBeHidden();
  await expect(page.getByRole('button', { name: '从模板库新建' })).toBeVisible();
});

// 字宽表按估算排版：用这台电脑的系统字体真实渲染每个模板的缩略图，没有哪一行被裁。CI 在 Windows 和 macOS 上都跑。
test('lays out every library template so that no line is clipped with the system fonts', async ({ electronApp }) => {
  const { app, page } = await electronApp.launch();
  const previews = await callApi(page, 'listTemplateLibrary');
  expect(previews.map((preview) => preview.id)).toEqual(TEMPLATE_LIBRARY.map((entry) => entry.template.id));
  for (const preview of previews) {
    expect({ template: preview.name, clipped: await clippedLines(app, preview.html) }).toEqual({
      template: preview.name,
      clipped: [],
    });
  }
});
