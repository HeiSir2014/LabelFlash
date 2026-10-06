/**
 * 退出程序时模板页还有没保存的修改：要不要问、问什么、保存怎么往返。不依赖 Electron（对话框、app.quit 在 index.ts 里），方便单测。
 *
 * 保存走界面现有的保存流程（`templates:save`，和点「保存模板」一样校验、写库、刷新列表）：主进程只发一个「请保存」，
 * 界面保存完回一句成不成功。等不到回答（界面卡住、出错）就当没存上，不退出，免得改了半天的模板悄悄丢掉。
 */

/** 确认框的按钮，顺序就是 showMessageBox 返回的 response。 */
export const TEMPLATE_QUIT_BUTTONS = ['取消', '不保存退出', '保存并退出'] as const;

export type TemplateQuitChoice = 'cancel' | 'discard' | 'save';

/** 确认框选了哪个按钮；意外的值按「取消」处理：宁可不退出，也不丢修改。 */
export function templateQuitChoice(response: number): TemplateQuitChoice {
  switch (TEMPLATE_QUIT_BUTTONS[response]) {
    case '不保存退出':
      return 'discard';
    case '保存并退出':
      return 'save';
    default:
      return 'cancel';
  }
}

/** 确认框的文字：只说程序确知的事——这个模板改过、还没存。 */
export function templateQuitDialogText(name: string): { message: string; detail: string } {
  return {
    message: `模板「${name}」有没保存的修改，现在退出吗？`,
    detail: '「保存并退出」先保存这个模板再退出；「不保存退出」放弃这些修改；「取消」回到程序接着改。',
  };
}

/** 保存没成功（校验没过、写库出错、界面没回答）：不退出，说清楚下一步。 */
export function templateSaveFailedText(name: string): { message: string; detail: string } {
  return {
    message: `模板「${name}」没有保存成功，程序没有退出`,
    detail: '请在模板页看一下提示、改好后点「保存模板」，再退出。',
  };
}

/** 等界面保存模板最多多久：存一次模板（校验、写库）不到一秒，等这么久还没回答多半是界面卡住了。 */
export const SAVE_FOR_QUIT_TIMEOUT_MS = 10_000;

/**
 * 记着「有没保存的模板」（界面经 `templates:unsaved-changed` 报告名字，没有时报 null），
 * 退出时据此决定要不要问；选了「保存并退出」时向界面要一次保存、等它回答。
 */
export class TemplateQuitGuard {
  private unsavedName: string | null = null;
  private pending: ((saved: boolean) => void) | null = null;

  setUnsaved(name: string | null): void {
    this.unsavedName = name;
  }

  get unsaved(): string | null {
    return this.unsavedName;
  }

  /** 要不要问：有没保存的模板，而且不是系统正在关机、注销（关机时不能挡着）。 */
  shouldConfirm(isSystemShutdown: boolean): boolean {
    return this.unsavedName !== null && !isSystemShutdown;
  }

  /** 请界面保存（ask 发出请求），等它回答；timeoutMs 内没回答当作没存上。 */
  requestSave(ask: () => void, timeoutMs: number): Promise<boolean> {
    this.pending?.(false);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => this.settle(false), timeoutMs);
      this.pending = (saved) => {
        clearTimeout(timer);
        resolve(saved);
      };
      ask();
    });
  }

  /** 界面回答保存结果；没人在等时什么也不做（比如超时之后才回来）。 */
  saved(isSaved: boolean): void {
    this.settle(isSaved);
  }

  private settle(isSaved: boolean): void {
    const pending = this.pending;
    this.pending = null;
    pending?.(isSaved);
  }
}
