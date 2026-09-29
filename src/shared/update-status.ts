/** 自动更新的状态：主进程推送给界面，界面据此显示标题栏提示和「关于」里的更新状态。 */
export type UpdateStatus =
  /** development：开发版；unsupported-platform：这个平台的安装包不能自动更新（macOS 的安装包没有 Apple 开发者签名）。 */
  | { state: 'disabled'; reason: 'development' | 'unsupported-platform' }
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'up-to-date'; checkedAt: number }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error' };
