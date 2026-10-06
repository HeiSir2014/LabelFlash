import { describe, expect, test } from 'bun:test';
import {
  BATCH_VIEW,
  backStep,
  CONFIG_NAV,
  CONFIG_PAGES,
  configShortcutLabel,
  isConfigShortcut,
  isFillPage,
  PDF_VIEW,
  pageLabel,
  platformForChrome,
  type ShortcutKey,
  WORKBENCH,
} from './app-view';

const key = (overrides: Partial<ShortcutKey> = {}): ShortcutKey => ({
  key: ',',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
});

describe('config navigation', () => {
  test('lists every page exactly once, in four groups', () => {
    const pages = CONFIG_NAV.flatMap((group) => group.pages.map((item) => item.page));
    expect(pages).toEqual([...CONFIG_PAGES]);
    expect(CONFIG_NAV.map((group) => group.label)).toEqual(['标签', '识别', '集成', '系统']);
    expect(pageLabel('notes')).toBe('常用备注');
  });

  test('keeps the local api and LAN sharing with the other integrations', () => {
    const integrations = CONFIG_NAV.find((group) => group.label === '集成');
    expect(integrations?.pages.map((item) => item.page)).toEqual(['webhooks', 'localApi', 'sharing']);
    expect(pageLabel('localApi')).toBe('本机接口');
    expect(pageLabel('sharing')).toBe('局域网共享');
  });

  // 打印机是准备工作（按纸张分配），和模板放在一起；工作台右侧只留每天都看的打印记录。
  test('puts the printers next to the templates', () => {
    const labels = CONFIG_NAV.find((group) => group.label === '标签');
    expect(labels?.pages.map((item) => item.page)).toEqual(['templates', 'printers', 'notes']);
    expect(pageLabel('printers')).toBe('打印机');
  });

  test('lets only the pages with a fixed preview or tester lay out their own scrolling', () => {
    expect(CONFIG_PAGES.filter(isFillPage)).toEqual(['templates', 'rules']);
  });
});

describe('backStep', () => {
  test('closes an open editor first, then the config center, and does nothing on the workbench', () => {
    expect(backStep({ kind: 'config', page: 'rules' }, true)).toBe('close-editor');
    expect(backStep({ kind: 'config', page: 'rules' }, false)).toBe('close-config');
    expect(backStep(WORKBENCH, false)).toBe('none');
    expect(backStep(BATCH_VIEW, false)).toBe('close-batch');
    expect(backStep(PDF_VIEW, false)).toBe('close-pdf');
  });
});

describe('config shortcut', () => {
  test('is Ctrl+, on Windows and ⌘, on macOS, without other modifiers', () => {
    expect(isConfigShortcut(key({ ctrlKey: true }), 'other')).toBe(true);
    expect(isConfigShortcut(key({ metaKey: true }), 'mac')).toBe(true);
    expect(isConfigShortcut(key({ ctrlKey: true }), 'mac')).toBe(false);
    expect(isConfigShortcut(key({ ctrlKey: true, shiftKey: true }), 'other')).toBe(false);
    expect(isConfigShortcut(key({ ctrlKey: true, altKey: true }), 'other')).toBe(false);
    expect(isConfigShortcut(key({ metaKey: true, ctrlKey: true }), 'mac')).toBe(false);
    expect(isConfigShortcut(key({ metaKey: true }), 'other')).toBe(false);
    expect(isConfigShortcut(key(), 'other')).toBe(false);
    expect(configShortcutLabel('mac')).toBe('⌘,');
    expect(configShortcutLabel('other')).toBe('Ctrl+,');
  });

  test('follows the window chrome the main process chose for this platform', () => {
    expect(platformForChrome('mac-traffic-lights')).toBe('mac');
    expect(platformForChrome('custom-buttons')).toBe('other');
  });
});
