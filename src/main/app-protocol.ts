import { pathToFileURL } from 'node:url';
import { net, protocol } from 'electron';
import { APP_SCHEME, resolveBundlePath } from './bundle-path';

/** 必须在 app ready 之前调用。 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

/** app ready 之后调用：只服务 rootDir（渲染进程构建目录）里的文件。 */
export function handleAppScheme(rootDir: string): void {
  protocol.handle(APP_SCHEME, (request) => {
    const filePath = resolveBundlePath(rootDir, request.url);
    if (!filePath) {
      return new Response('Not Found', { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}
