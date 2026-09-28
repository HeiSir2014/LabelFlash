import { app, session } from 'electron';
import { isPermissionGranted } from './permissions';

/**
 * 对所有 webContents（主窗口、打印窗口，以及将来新增的任何窗口）统一收紧：
 * 禁止打开新窗口、禁止页面内导航和服务器重定向、禁止挂载 <webview>。必须在 app ready 之前调用。
 */
export function hardenAllWebContents(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => event.preventDefault());
    // 重定向不经过 will-navigate：界面只加载本地内容，任何重定向都不是预期行为。
    contents.on('will-redirect', (event) => event.preventDefault());
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}

/** 网页权限只放行往剪贴板写纯文本（见 permissions.ts）；摄像头、通知、读取剪贴板等请求和检查一律拒绝。 */
export function restrictPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) =>
    callback(isPermissionGranted(permission)),
  );
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => isPermissionGranted(permission));
}
