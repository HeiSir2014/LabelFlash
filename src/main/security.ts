import { app, session } from 'electron';

/**
 * 对所有 webContents（主窗口、打印窗口，以及将来新增的任何窗口）统一收紧：
 * 禁止打开新窗口、禁止页面内导航、禁止挂载 <webview>。必须在 app ready 之前调用。
 */
export function hardenAllWebContents(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}

/** 本应用不需要任何网页权限（摄像头、通知、剪贴板读取……）：请求和检查一律拒绝。 */
export function denyAllPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
}
