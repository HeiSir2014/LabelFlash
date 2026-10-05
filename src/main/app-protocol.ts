import { pathToFileURL } from 'node:url';
import { net, type Protocol, protocol } from 'electron';
import { APP_SCHEME, resolveBundlePath } from './bundle-path';

/** 必须在 app ready 之前调用。 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

/**
 * app ready 之后调用：只服务 rootDir（渲染进程构建目录）里的文件。
 * target 默认是主窗口用的默认会话；PDF 渲染页的独立会话也挂一份（见 pdf/pdf-render-window.ts），
 * 那一份给每个响应加上 csp：worker 脚本不继承页面 meta 里的内容安全策略，只认响应头。
 */
export function handleAppScheme(rootDir: string, target: Protocol = protocol, csp: string | null = null): void {
  target.handle(APP_SCHEME, async (request) => {
    const filePath = resolveBundlePath(rootDir, request.url);
    if (!filePath) {
      return new Response('Not Found', { status: 404 });
    }
    const response = await net.fetch(pathToFileURL(filePath).toString());
    if (csp === null) {
      return response;
    }
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', csp);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  });
}
