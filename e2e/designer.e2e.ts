import type { Locator, Page } from '@playwright/test';
import type { CanvasElement } from '../src/core/templates/canvas-model';
import { callApi, openConfig, scan } from './support/app-helpers';
import { quitDialogs, stubQuitDialogs } from './support/electron-app';
import { expect, test } from './support/fixtures';

/**
 * 自由设计的设计器：点中测试、全选、就地改字、右键菜单、图层、「放大到能印」、退出时没保存的模板。
 * 每个用例先用接口存一个带元素的模板，再从模板页进设计器，元素的位置都是已知的毫米数。
 */

const PAPER = { widthMm: 60, heightMm: 40 };
const TEMPLATE_NAME = 'E2E 设计器';
const BASE = { rotation: 0, locked: false } as const;

function text(id: string, name: string, value: string, box: { x: number; y: number; width: number; height: number }) {
  return {
    ...BASE,
    ...box,
    id,
    kind: 'text',
    name,
    text: value,
    fontSizeMm: 5,
    bold: true,
    align: 'left',
    valign: 'middle',
    fit: 'shrink',
    inverse: false,
  } as CanvasElement;
}

const PRICE = text('e1', '文字', '¥199.00', { x: 2, y: 16, width: 30, height: 7 });
const BORDER = {
  ...BASE,
  id: 'e2',
  kind: 'rect',
  name: '矩形',
  x: 0.5,
  y: 0.5,
  width: 59,
  height: 39,
  borderMm: 0.3,
  filled: false,
  radiusMm: 0,
} as CanvasElement;

interface Designer {
  designer: Locator;
  overlay: Locator;
  layers: Locator;
  inspector: Locator;
  checks: Locator;
  label: ReturnType<Page['frameLocator']>;
  /** 纸上 (x, y) mm 在窗口里的位置。 */
  at: (xMm: number, yMm: number) => Promise<{ x: number; y: number }>;
}

/** 存一个带这些元素的自由设计模板，扫一段预览内容，从模板页进设计器。 */
async function openDesigner(page: Page, elements: readonly CanvasElement[]): Promise<Designer> {
  const created = await callApi(page, 'createCanvasTemplate');
  await callApi(page, 'saveTemplate', { ...created, name: TEMPLATE_NAME, paper: PAPER, elements: [...elements] });
  // 模板列表在启动时读一次：接口直接存的模板要重新载入页面才看得见。
  await page.reload();
  await expect(page.locator('.scan-bar__input')).toBeVisible();
  await scan(page, 'CL5640-TK-图片色-XL');
  await openConfig(page, '模板');
  await page.locator('.template-item', { hasText: TEMPLATE_NAME }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  const designer = page.getByRole('region', { name: '设计器' });
  await expect(designer).toBeVisible();
  const overlay = page.locator('.canvas-overlay');
  const label = page.getByRole('main', { name: '模板' }).frameLocator('.label-frame');
  await expect(label.locator('body')).toBeVisible();
  return {
    designer,
    overlay,
    layers: designer.getByRole('list', { name: '图层' }),
    inspector: designer.getByRole('complementary', { name: '检查器' }),
    checks: designer.getByRole('region', { name: '打印前检查' }),
    label,
    at: async (xMm, yMm) => {
      const box = await overlay.boundingBox();
      if (box === null) {
        throw new Error('the canvas is not visible');
      }
      return { x: box.x + (xMm * box.width) / PAPER.widthMm, y: box.y + (yMm * box.height) / PAPER.heightMm };
    },
  };
}

async function clickAt(page: Page, d: Designer, xMm: number, yMm: number, options = {}): Promise<void> {
  const point = await d.at(xMm, yMm);
  await page.mouse.click(point.x, point.y, options);
}

/** 图层列表里一行的「选中」按钮（名字形如「¥199.00（文字）」）。 */
function layer(d: Designer, name: string): Locator {
  return d.layers.getByRole('button', { name, exact: true });
}

async function showLayers(d: Designer): Promise<void> {
  await d.inspector.getByRole('tab', { name: '图层' }).click();
}

test('clicks through an outline-only border rectangle to the element underneath', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  const d = await openDesigner(page, [PRICE, BORDER]);
  await showLayers(d);

  // 矩形盖在价格上面，但只有边框：点在框里面落到价格上。
  await clickAt(page, d, 10, 19);
  await expect(layer(d, '¥199.00（文字）')).toHaveAttribute('aria-pressed', 'true');
  await expect(layer(d, '矩形（矩形）')).toHaveAttribute('aria-pressed', 'false');

  // 点在边框上选中矩形。
  await clickAt(page, d, 0.6, 30);
  await expect(layer(d, '矩形（矩形）')).toHaveAttribute('aria-pressed', 'true');

  // 从矩形里面的空白处开始拖：是框选，不是拖动矩形。
  const from = await d.at(1.5, 14);
  const to = await d.at(35, 25);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await expect(layer(d, '¥199.00（文字）')).toHaveAttribute('aria-pressed', 'true');
  await expect(layer(d, '矩形（矩形）')).toHaveAttribute('aria-pressed', 'false');
});

test('selects every unlocked element with Ctrl+A without selecting page text', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  const locked = {
    ...text('e3', '锁住的', '锁', { x: 40, y: 2, width: 10, height: 5 }),
    locked: true,
  } as CanvasElement;
  const d = await openDesigner(page, [PRICE, BORDER, locked]);
  await showLayers(d);
  await d.overlay.focus();
  await page.keyboard.press('Control+a');
  await expect(d.layers.locator('.layer-row__select[aria-pressed="true"]')).toHaveCount(2);
  await expect(layer(d, '锁住的（文字 · 锁定）')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
});

test('edits text in place, undoes the whole edit in one step and cancels with Esc', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  const d = await openDesigner(page, [PRICE]);
  const editor = page.getByRole('textbox', { name: /就地改文字/ });
  const content = d.inspector.getByLabel('内容', { exact: true });

  await clickAt(page, d, 10, 19);
  const point = await d.at(10, 19);
  await page.mouse.dblclick(point.x, point.y);
  await expect(editor).toBeFocused();
  // 一进来整段选中：打字就是替换。Enter 换行，Ctrl+Enter 改完。
  await page.keyboard.type('¥88');
  await page.keyboard.press('Enter');
  await page.keyboard.type('特价');
  await page.keyboard.press('Control+Enter');
  await expect(editor).toHaveCount(0);
  await expect(content).toHaveValue('¥88\n特价');
  await expect(d.label.locator('.line', { hasText: '¥88' })).toBeVisible();
  await expect(d.overlay).toBeFocused();

  // 一次撤销回到改之前（整段编辑是一步）。
  await page.keyboard.press('Control+z');
  await expect(content).toHaveValue('¥199.00');

  // Esc 放弃：内容不变，也不离开设计器。
  await page.mouse.dblclick(point.x, point.y);
  await expect(editor).toBeFocused();
  await page.keyboard.type('不要了');
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(content).toHaveValue('¥199.00');
  await expect(d.designer).toBeVisible();
});

test('nudges with the arrow keys and undoes a held key in one step', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  const d = await openDesigner(page, [PRICE]);
  await clickAt(page, d, 10, 19);
  await d.inspector.getByRole('tab', { name: '排列' }).click();
  const x = d.inspector.getByLabel('X', { exact: true });
  await d.overlay.focus();
  for (let press = 0; press < 10; press += 1) {
    await page.keyboard.press('ArrowRight');
  }
  await expect.poll(async () => Number(await x.inputValue())).toBeCloseTo(3, 5);
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => Number(await x.inputValue())).toBeCloseTo(4, 5);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => Number(await x.inputValue())).toBeCloseTo(2, 5);
});

test('opens the context menu on the canvas and runs its items from the keyboard', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  const d = await openDesigner(page, [PRICE, BORDER]);
  const menu = page.getByRole('menu', { name: '元素菜单' });

  await clickAt(page, d, 10, 19, { button: 'right' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /复制一份/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /置底/ })).toBeVisible();
  // 焦点在第一项「复制」；往下跳过不能用的「粘贴」，到「复制一份」，回车执行。
  await expect(menu.getByRole('menuitem', { name: /^复制/ }).first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: /复制一份/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await showLayers(d);
  await expect(d.layers.getByRole('listitem')).toHaveCount(3);

  // 选两个以上时有「对齐」子菜单；Esc 收起菜单，不离开设计器。
  await d.overlay.focus();
  await page.keyboard.press('Control+a');
  await clickAt(page, d, 10, 19, { button: 'right' });
  await expect(menu.getByRole('menuitem', { name: /对齐/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(d.designer).toBeVisible();
});

test('locks, hides, renames and reorders layers', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  const top = text('e2', '上层', '上层', { x: 2, y: 2, width: 20, height: 6 });
  const d = await openDesigner(page, [PRICE, top]);
  await showLayers(d);

  // 锁定：画布上点不中（只能在图层里选），能撤销。
  await d.layers.getByRole('button', { name: '锁定「上层」' }).click();
  await clickAt(page, d, 10, 5);
  await expect(layer(d, '上层（文字 · 锁定）')).toHaveAttribute('aria-pressed', 'false');
  await d.overlay.focus();
  await page.keyboard.press('Control+z');
  await expect(layer(d, '上层（文字）')).toBeVisible();

  // 隐藏：只在设计器里看不见，覆盖层上没有框；照常打印（模板里没有记这一项）。
  await d.layers.getByRole('button', { name: '隐藏「¥199.00」' }).click();
  await expect(d.label.locator('[data-element-id="e1"]')).toBeHidden();
  await expect(page.locator('.canvas-overlay__box[data-element-id="e1"]')).toHaveCount(0);
  await d.layers.getByRole('button', { name: '显示「¥199.00」' }).click();
  await expect(d.label.locator('[data-element-id="e1"]')).toBeVisible();

  // 双击名字就地改名，回车保存；撤销回到原来的名字。
  await layer(d, '¥199.00（文字）').dblclick();
  const rename = d.layers.getByRole('textbox', { name: '图层名称' });
  await expect(rename).toBeFocused();
  await rename.fill('价格');
  await rename.press('Enter');
  await expect(layer(d, '价格（文字）')).toBeVisible();
  await d.overlay.focus();
  await page.keyboard.press('Control+z');
  await expect(layer(d, '¥199.00（文字）')).toBeVisible();

  // 排序：列表上层在前。Ctrl+] 把价格上移一层，到最前；再把它拖到「上层」下面放回去。
  const order = () => d.layers.getByRole('listitem').locator('.layer-row__name').allTextContents();
  expect(await order()).toEqual(['上层', '¥199.00']);
  await layer(d, '¥199.00（文字）').click();
  await d.overlay.focus();
  await page.keyboard.press('Control+]');
  await expect.poll(order).toEqual(['¥199.00', '上层']);
  const rows = d.layers.getByRole('listitem');
  const target = await rows.nth(1).boundingBox();
  if (target === null) {
    throw new Error('the layer row is not visible');
  }
  await rows.nth(0).dragTo(rows.nth(1), { targetPosition: { x: 20, y: target.height - 4 } });
  await expect.poll(order).toEqual(['上层', '¥199.00']);
});

test('grows a barcode that is too narrow to print', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  const barcode = {
    ...BASE,
    id: 'e1',
    kind: 'barcode',
    name: '条码',
    x: 2,
    y: 20,
    width: 20,
    height: 12,
    symbology: 'code128',
    value: '{编码}',
    showText: true,
    textSizeMm: 2.5,
  } as CanvasElement;
  const d = await openDesigner(page, [barcode]);
  await expect(d.checks).toContainText(/条码「条码」不印：内容 CL5640-TK 至少要 [\d.]+mm 宽（现在 20mm）/);
  // 画布上这个框是浅红底，框里写着短原因。
  await expect(page.locator('.canvas-overlay__box--omitted')).toContainText('条码不印：框不够宽');

  await clickAt(page, d, 10, 25);
  await d.inspector.getByRole('button', { name: '放大到能印' }).click();
  await expect(d.checks).toContainText('没有发现问题');
  await expect(d.label.locator('svg[shape-rendering="crispEdges"]')).toHaveCount(1);
  await d.inspector.getByRole('tab', { name: '排列' }).click();
  expect(Number(await d.inspector.getByLabel('宽', { exact: true }).inputValue())).toBeGreaterThan(20);
});

test('asks about an unsaved template when quitting, and saves it when asked', async ({ electronApp }) => {
  const first = await electronApp.launch();
  const d = await openDesigner(first.page, [PRICE]);
  await d.designer.getByRole('button', { name: '添加线' }).click();
  await expect(first.page.getByText('有未保存的修改')).toBeVisible();

  // 「取消」：程序不退出。
  await stubQuitDialogs(first.app, [0]);
  await first.app.evaluate(({ app }) => app.quit());
  await expect.poll(() => quitDialogs(first.app)).toEqual([`模板「${TEMPLATE_NAME}」有没保存的修改，现在退出吗？`]);
  expect(await first.app.evaluate(({ app }) => app.getVersion())).toBeTruthy();

  // 「保存并退出」：界面按平常的流程保存，程序退出；重开以后模板里有新加的线。
  await stubQuitDialogs(first.app, [2]);
  const closed = first.app.waitForEvent('close');
  await first.app.evaluate(({ app }) => app.quit());
  await closed;
  const second = await electronApp.launch();
  const saved = (await callApi(second.page, 'listTemplates')).find((template) => template.name === TEMPLATE_NAME);
  expect(saved?.kind === 'canvas' && saved.elements.map((element) => element.kind)).toEqual(['text', 'line']);
});
