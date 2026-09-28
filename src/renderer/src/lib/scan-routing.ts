import type { AppView, ConfigPage } from './app-view';

export type ScanTarget = 'scan-box' | 'test-box' | 'sink';

/** 有测试框的页面：识别规则的「试一试」、模板的「预览内容」。在这些页面扫码，内容填进测试框。 */
const PAGES_WITH_TEST_BOX: ReadonlySet<ConfigPage> = new Set(['rules', 'templates']);

/** 焦点不在输入框时，扫码枪打出的字符送到哪里（配置中心里永远不打印）。 */
export function scanTargetFor(view: AppView): ScanTarget {
  if (view.kind === 'workbench') {
    return 'scan-box';
  }
  return PAGES_WITH_TEST_BOX.has(view.page) ? 'test-box' : 'sink';
}

/** F2 打印和扫码框的自动回焦只在工作台生效：配置中心里管理员在填表，焦点留在他放的位置。 */
export function isWorkbenchActive(view: AppView): boolean {
  return view.kind === 'workbench';
}
