import type { WindowChrome } from '../../../shared/window-chrome';

/** 配置中心的页面，顺序就是导航顺序。 */
export const CONFIG_PAGES = [
  'templates',
  'notes',
  'rules',
  'lookup',
  'secrets',
  'webhooks',
  'voice',
  'general',
  'about',
] as const;
export type ConfigPage = (typeof CONFIG_PAGES)[number];

export interface NavGroup {
  label: string;
  pages: ReadonlyArray<{ page: ConfigPage; label: string }>;
}

export const CONFIG_NAV: readonly NavGroup[] = [
  {
    label: '标签',
    pages: [
      { page: 'templates', label: '模板' },
      { page: 'notes', label: '常用备注' },
    ],
  },
  {
    label: '识别',
    pages: [
      { page: 'rules', label: '识别规则' },
      { page: 'lookup', label: '查找表' },
      { page: 'secrets', label: '密钥' },
    ],
  },
  { label: '集成', pages: [{ page: 'webhooks', label: '打印结果通知' }] },
  {
    label: '系统',
    pages: [
      { page: 'voice', label: '语音播报' },
      { page: 'general', label: '通用' },
      { page: 'about', label: '关于' },
    ],
  },
];

const PAGE_LABELS = new Map(CONFIG_NAV.flatMap((group) => group.pages.map((item) => [item.page, item.label])));

export function pageLabel(page: ConfigPage): string {
  return PAGE_LABELS.get(page) ?? page;
}

/** 这些页面铺满内容区，自己安排滚动区域和底部操作条（列表 / 表单滚动，预览和试一试固定）。 */
const FILL_PAGES: ReadonlySet<ConfigPage> = new Set(['templates', 'rules']);

export function isFillPage(page: ConfigPage): boolean {
  return FILL_PAGES.has(page);
}

/** 整个窗口只有两种视图：工作台，或配置中心的某一页。 */
export type AppView = { kind: 'workbench' } | { kind: 'config'; page: ConfigPage };

export const WORKBENCH: AppView = { kind: 'workbench' };

export type BackStep = 'close-editor' | 'close-config' | 'none';

/** Esc 和「返回」：编辑器开着就先回到列表，否则关掉配置中心回工作台。 */
export function backStep(view: AppView, isEditing: boolean): BackStep {
  if (view.kind === 'workbench') {
    return 'none';
  }
  return isEditing ? 'close-editor' : 'close-config';
}

export type Platform = 'mac' | 'other';

/** 按主进程选的窗口样式判断平台：有系统红绿灯的就是 macOS。 */
export function platformForChrome(chrome: WindowChrome): Platform {
  return chrome === 'mac-traffic-lights' ? 'mac' : 'other';
}

export interface ShortcutKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** 打开 / 关闭配置中心：Windows 是 Ctrl+,，macOS 是 ⌘,（系统惯例的「设置」快捷键）。 */
export function isConfigShortcut(event: ShortcutKey, platform: Platform): boolean {
  const isPrimary = platform === 'mac' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return event.key === ',' && isPrimary && !event.altKey && !event.shiftKey;
}

export function configShortcutLabel(platform: Platform): string {
  return platform === 'mac' ? '⌘,' : 'Ctrl+,';
}
