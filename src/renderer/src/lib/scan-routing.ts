import type { AppView, ConfigPage } from './app-view';

/**
 * 扫码的去处：工作台的扫码框；识别规则页的「试一试」；模板页的「预览内容」；
 * 其他配置页的隐藏接收框（只提醒「正在配置，没有打印」）。
 */
export type ScanTarget = 'scan-box' | 'rule-tester' | 'template-sample' | 'sink';

/** 有测试框的页面：在这些页面扫码，内容替换测试框里原有的内容。 */
const TEST_BOXES: ReadonlyMap<ConfigPage, ScanTarget> = new Map([
  ['rules', 'rule-tester'],
  ['templates', 'template-sample'],
]);

/** 焦点不在输入框时，扫码枪打出的字符送到哪里（配置中心、批量打印页里永远不打印）。 */
export function scanTargetFor(view: AppView): ScanTarget {
  if (view.kind === 'workbench') {
    return 'scan-box';
  }
  if (view.kind === 'batch') {
    return 'sink';
  }
  return TEST_BOXES.get(view.page) ?? 'sink';
}

/** F2 打印和扫码框的自动回焦只在工作台生效：配置中心、批量打印页里管理员在填表，焦点留在他放的位置。 */
export function isWorkbenchActive(view: AppView): boolean {
  return view.kind === 'workbench';
}
