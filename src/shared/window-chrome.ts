/**
 * 标题栏的窗口按钮由谁来画。主进程创建窗口和渲染进程画标题栏都以它为准，两边不会不一致。
 * - macOS：保留系统红绿灯（用户的肌肉记忆在左上角），标题栏内容给它让出位置。
 * - 其它平台：无系统边框，由界面自绘最小化 / 最大化 / 关闭按钮。
 */
export type WindowChrome = 'mac-traffic-lights' | 'custom-buttons';

export function windowChromeFor(platform: string): WindowChrome {
  return platform === 'darwin' ? 'mac-traffic-lights' : 'custom-buttons';
}
