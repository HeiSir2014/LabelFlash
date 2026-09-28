import { expect, test } from '@playwright/test';
import { launchApp } from '../support/electron-app';
import { type CheckName, DEFAULT_CHECK_OPTIONS, pageChecks } from './checks';

test('each visual check catches a deliberately broken element', async () => {
  const { page, close } = await launchApp();
  // 在工作台里放一组故意出错的元素（只用 CSSOM 设样式，CSP 不拦）。
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.className = 'fx-host';
    const add = (tag: string, className: string, style: Partial<CSSStyleDeclaration>, text = '') => {
      const element = document.createElement(tag);
      element.className = className;
      Object.assign(element.style, style);
      element.textContent = text;
      host.append(element);
      return element;
    };
    const scroller = add('div', 'fx-scroller', { width: '100px', height: '40px', overflow: 'auto' });
    const wide = document.createElement('div');
    wide.style.width = '300px';
    wide.style.height = '10px';
    scroller.append(wide);
    add(
      'span',
      'fx-clipped',
      { display: 'block', width: '50px', overflow: 'hidden', whiteSpace: 'nowrap' },
      '一段放不下的文字',
    );
    add('div', 'fx-a', { position: 'fixed', left: '0', top: '0', width: '50px', height: '50px' });
    add('div', 'fx-b', { position: 'fixed', left: '20px', top: '20px', width: '50px', height: '50px' });
    add('button', 'fx-small', { height: '20px' }, '小');
    add('p', 'fx-faint', { color: '#cccccc', background: '#ffffff' }, '看不清的字');
    add('div', 'fx-grid', { padding: '5px' }, '格');
    document.querySelector('.station')?.prepend(host);
    // 假装配置中心开着，而工作台没有 inert、焦点还在扫码框里。
    const center = document.createElement('div');
    center.className = 'config-center';
    document.body.append(center);
  });
  const issues = await page.evaluate(pageChecks, {
    ...DEFAULT_CHECK_OPTIONS,
    regions: ['.fx-a', '.fx-b'],
    spacing: ['.fx-grid'],
  });
  const found = (check: CheckName, text: string) =>
    issues.some((issue) => issue.check === check && issue.detail.includes(text));
  expect(found('horizontal-overflow', 'fx-scroller')).toBe(true);
  expect(found('clipped-text', '一段放不下的文字')).toBe(true);
  expect(found('overlap', 'fx-a')).toBe(true);
  expect(found('small-target', 'fx-small')).toBe(true);
  expect(found('low-contrast', '看不清的字')).toBe(true);
  expect(found('off-grid-spacing', 'fx-grid')).toBe(true);
  expect(found('focus', 'inert')).toBe(true);
  await close();
});

test('the workbench and the config center pass the visual checks', async () => {
  const { page, close } = await launchApp();
  // 先把每一页的问题都收齐再断言：一次看到全部问题。
  const found: Record<string, unknown[]> = { 工作台: await page.evaluate(pageChecks, DEFAULT_CHECK_OPTIONS) };
  await page.getByRole('button', { name: '配置', exact: true }).click();
  const nav = page.getByRole('navigation', { name: '配置' });
  for (const name of ['模板', '常用备注', '识别规则', '查找表', '密钥', '打印结果通知', '语音播报', '通用', '关于']) {
    await nav.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    found[name] = await page.evaluate(pageChecks, DEFAULT_CHECK_OPTIONS);
  }
  const problems = Object.fromEntries(Object.entries(found).filter(([, issues]) => issues.length > 0));
  expect(problems).toEqual({});
  await close();
});
