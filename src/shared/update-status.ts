/** 自动更新的状态：主进程推送给界面，界面据此显示标题栏提示和「关于」里的更新状态。 */
export type UpdateStatus =
  | { state: 'disabled' }
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'up-to-date'; checkedAt: number }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error' };
