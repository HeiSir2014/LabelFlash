export interface CloseState {
  /** 托盘图标建起来了：窗口藏进托盘之后还叫得回来。 */
  hasTray: boolean;
  /** 退出已经确定要发生（before-quit 放行了，或系统在关机、在装更新）。 */
  isQuitting: boolean;
}

/**
 * 点主窗口的关闭时做什么：
 * - hide：藏进托盘，程序接着跑；
 * - quit：没有托盘，关窗就是退出。窗口先留着、交给 app.quit() 走退出确认（批量打印、没保存的模板）。
 *   直接关掉的话，确认框选了「取消」程序还在跑，却没有窗口也没有托盘，再也叫不回来；
 * - close：退出已经确定，放行。
 */
export function closeAction({ hasTray, isQuitting }: CloseState): 'hide' | 'quit' | 'close' {
  if (isQuitting) {
    return 'close';
  }
  return hasTray ? 'hide' : 'quit';
}
