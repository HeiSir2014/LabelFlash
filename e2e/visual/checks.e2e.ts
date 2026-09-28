import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { type CheckName, DEFAULT_CHECK_OPTIONS, type Issue, pageChecks } from './checks';

/** 内联样式：键是 CSSStyleDeclaration 的属性名（例如 whiteSpace）。 */
type InlineStyle = Readonly<Record<string, string>>;

/** 放进工作台的一个元素。类名和文字都会出现在问题描述里，断言靠它们认出是哪个元素。 */
interface Fixture {
  tag: string;
  className: string;
  style: InlineStyle;
  text?: string;
  title?: string;
  attributes?: Record<string, string>;
  /** 放进上一个元素里，而不是放在最外层。 */
  nested?: boolean;
}

/** 把元素放到工作台最上面（只用 CSSOM 设样式，CSP 不拦）。 */
async function mountFixtures(page: Page, fixtures: readonly Fixture[]): Promise<void> {
  await page.evaluate((items) => {
    const host = document.createElement('div');
    host.className = 'fx-host';
    let previous: HTMLElement = host;
    for (const item of items) {
      const element = document.createElement(item.tag);
      element.className = item.className;
      Object.assign(element.style, item.style);
      element.textContent = item.text ?? '';
      if (item.title !== undefined) {
        element.title = item.title;
      }
      for (const [name, value] of Object.entries(item.attributes ?? {})) {
        element.setAttribute(name, value);
      }
      (item.nested ? previous : host).append(element);
      previous = element;
    }
    document.querySelector('.station')?.prepend(host);
  }, fixtures);
}

function hasIssue(issues: readonly Issue[], check: CheckName, text: string): boolean {
  return issues.some((issue) => issue.check === check && issue.detail.includes(text));
}

const NO_WRAP_CLIP: InlineStyle = { overflow: 'hidden', whiteSpace: 'nowrap' };
const ELLIPSIS: InlineStyle = { ...NO_WRAP_CLIP, textOverflow: 'ellipsis' };

test('each visual check catches a deliberately broken element', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  await mountFixtures(page, [
    { tag: 'div', className: 'fx-scroller', style: { width: '100px', height: '40px', overflow: 'auto' } },
    { tag: 'div', className: 'fx-wide', style: { width: '300px', height: '10px' }, nested: true },
    {
      tag: 'span',
      className: 'fx-clipped',
      style: { ...NO_WRAP_CLIP, display: 'block', width: '50px' },
      text: '一段放不下的文字',
    },
    // 最常见的写法：裁剪在外层容器上，文字在里面的 span 里。
    { tag: 'div', className: 'fx-clip-parent', style: { width: '50px', overflow: 'hidden' } },
    { tag: 'span', className: 'fx-clip-child', style: { whiteSpace: 'nowrap' }, text: '外层裁掉的文字', nested: true },
    // 有省略号但没有悬停提示：看不到完整内容。
    { tag: 'div', className: 'fx-bare-ellipsis', style: { ...ELLIPSIS, width: '50px' }, text: '没有提示的省略号文字' },
    { tag: 'div', className: 'fx-a', style: { position: 'fixed', left: '0', top: '0', width: '50px', height: '50px' } },
    {
      tag: 'div',
      className: 'fx-b',
      style: { position: 'fixed', left: '20px', top: '20px', width: '50px', height: '50px' },
    },
    { tag: 'button', className: 'fx-small', style: { height: '20px' }, text: '小' },
    { tag: 'p', className: 'fx-faint', style: { color: '#cccccc', background: '#ffffff' }, text: '看不清的字' },
    // 20px 不到 WCAG 的大字（24px，粗体 18.67px）：约 3.5:1 不够，要 4.5:1。
    {
      tag: 'p',
      className: 'fx-medium',
      style: { color: '#898989', background: '#ffffff', fontSize: '20px', fontWeight: '400' },
      text: '二十像素的灰字',
    },
    // color-mix 的结果在 Chromium 里写成 color(srgb …)：黑字落在深灰上约 2.5:1；当成透明的话是白底黑字，查不出来。
    {
      tag: 'p',
      className: 'fx-mixed',
      style: { color: '#000000', background: 'color-mix(in srgb, #000000 70%, #ffffff)' },
      text: '混色背景上的字',
    },
    // lab() 这类写法算不出对比度：必须报出来，不能当成透明跳过。
    { tag: 'p', className: 'fx-lab', style: { color: '#000000', background: 'lab(50% 0 0)' }, text: 'lab 背景' },
    { tag: 'div', className: 'fx-grid', style: { padding: '5px' }, text: '格' },
  ]);
  // 假装配置中心开着，而工作台没有 inert、焦点还在扫码框里。
  await page.evaluate(() => {
    const center = document.createElement('div');
    center.className = 'config-center';
    document.body.append(center);
  });

  const issues = await pageChecks(page, {
    ...DEFAULT_CHECK_OPTIONS,
    regions: ['.fx-a', '.fx-b'],
    spacing: ['.fx-grid'],
  });
  expect(hasIssue(issues, 'horizontal-overflow', 'fx-scroller')).toBe(true);
  expect(hasIssue(issues, 'clipped-text', '一段放不下的文字')).toBe(true);
  expect(hasIssue(issues, 'clipped-text', '外层裁掉的文字')).toBe(true);
  expect(hasIssue(issues, 'clipped-text', '没有提示的省略号文字')).toBe(true);
  expect(hasIssue(issues, 'overlap', 'fx-a')).toBe(true);
  expect(hasIssue(issues, 'small-target', 'fx-small')).toBe(true);
  expect(hasIssue(issues, 'low-contrast', '看不清的字')).toBe(true);
  expect(hasIssue(issues, 'low-contrast', '二十像素的灰字')).toBe(true);
  expect(hasIssue(issues, 'low-contrast', '混色背景上的字')).toBe(true);
  expect(hasIssue(issues, 'unknown-color', '混色背景上的字')).toBe(false);
  expect(hasIssue(issues, 'unknown-color', 'lab 背景')).toBe(true);
  expect(hasIssue(issues, 'off-grid-spacing', 'fx-grid')).toBe(true);
  expect(hasIssue(issues, 'focus', 'inert')).toBe(true);
});

test('the visual checks accept intentional ellipses, allowed scrolling and clipping without text', async ({
  electronApp,
}) => {
  const { page } = await electronApp.launch();
  await mountFixtures(page, [
    // 省略号 + 悬停提示：有意截断，不算问题。
    {
      tag: 'div',
      className: 'fx-ok-ellipsis',
      style: { ...ELLIPSIS, width: '60px' },
      text: '带提示的省略号文字',
      title: '带提示的省略号文字',
    },
    // 省略号和提示在外层，文字在里面的 span 里。
    {
      tag: 'div',
      className: 'fx-ok-ellipsis-parent',
      style: { ...ELLIPSIS, width: '60px' },
      title: '外层带提示的文字',
    },
    { tag: 'span', className: 'fx-ok-ellipsis-child', style: {}, text: '外层带提示的文字', nested: true },
    // 明确允许横向滚动的表格区域。
    {
      tag: 'div',
      className: 'fx-ok-table',
      style: { width: '100px', height: '40px', overflow: 'auto' },
      attributes: { 'data-allow-x-scroll': '' },
    },
    {
      tag: 'div',
      className: 'fx-ok-table-row',
      style: { width: '300px', whiteSpace: 'nowrap' },
      text: '允许横向滚动的一整行很长的表格内容',
      nested: true,
    },
    // overflow-x: hidden 是裁剪不是滚动：里面的宽内容没有文字，既不算横向溢出，也没有被裁掉的字。
    {
      tag: 'div',
      className: 'fx-ok-clip-x',
      style: { width: '100px', height: '40px', overflowX: 'hidden', overflowY: 'auto' },
    },
    { tag: 'div', className: 'fx-ok-clip-x-bar', style: { width: '300px', height: '10px' }, nested: true },
    // margin: auto 居中（原生模态 <dialog> 就是这样居中的）：算出来的外边距不是间距取值，不查网格。
    { tag: 'div', className: 'fx-ok-centered', style: { width: '101px', margin: '0 auto', padding: '4px' } },
  ]);

  const issues = await pageChecks(page, {
    ...DEFAULT_CHECK_OPTIONS,
    spacing: [...DEFAULT_CHECK_OPTIONS.spacing, '.fx-ok-centered'],
  });
  expect(issues.filter((issue) => issue.detail.includes('fx-ok'))).toEqual([]);
});

test('the workbench and the config center pass the visual checks', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  // 先把每一页的问题都收齐再断言：一次看到全部问题。
  const found: Record<string, Issue[]> = { 工作台: await pageChecks(page) };
  await page.getByRole('button', { name: '配置', exact: true }).click();
  const nav = page.getByRole('navigation', { name: '配置' });
  for (const name of ['模板', '常用备注', '识别规则', '查找表', '密钥', '打印结果通知', '语音播报', '通用', '关于']) {
    await nav.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    found[name] = await pageChecks(page);
  }
  const problems = Object.fromEntries(Object.entries(found).filter(([, issues]) => issues.length > 0));
  expect(problems).toEqual({});
});
