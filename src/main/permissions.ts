/**
 * 页面能用的网页权限：只有「往剪贴板写入纯文本」（配置中心复制 {密钥:名称} 引用）。
 * 读取剪贴板、摄像头、通知等其他权限一律拒绝。
 */
const GRANTED_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write']);

export function isPermissionGranted(permission: string): boolean {
  return GRANTED_PERMISSIONS.has(permission);
}
