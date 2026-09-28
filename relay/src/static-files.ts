/**
 * 扫码页的静态文件。页面只从本站加载脚本、样式和 wasm，CSP 按最小权限写：
 * 不允许内联脚本、第三方资源和被别的网站嵌入；摄像头只给本站用。
 */
import { extname, resolve, sep } from 'node:path';

const PAGE_PREFIX = '/m/';
const INDEX_FILE = 'index.html';
/** 构建产物里带内容哈希的文件都放在 assets/：内容变了文件名就变，可以永久缓存。 */
const HASHED_DIR = 'assets/';
const CACHE_HASHED = 'public, max-age=31536000, immutable';
/** 页面本身每次都向服务器确认，发布新版本后手机刷新就能拿到。 */
const CACHE_PAGE = 'no-cache';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

export async function serveStatic(root: string, pathname: string, origin: string): Promise<Response> {
  const relative = toRelativePath(pathname);
  const contentType = relative === null ? undefined : CONTENT_TYPES[extname(relative)];
  if (relative === null || contentType === undefined) {
    return notFound();
  }
  const base = resolve(root);
  const target = resolve(base, relative);
  if (!target.startsWith(base + sep)) {
    return notFound();
  }
  const file = Bun.file(target);
  if (!(await file.exists())) {
    return notFound();
  }
  return new Response(file, {
    headers: {
      ...securityHeaders(origin),
      'Content-Type': contentType,
      'Cache-Control': relative.startsWith(HASHED_DIR) ? CACHE_HASHED : CACHE_PAGE,
    },
  });
}

export function securityHeaders(origin: string): Record<string, string> {
  const socketOrigin = origin.replace(/^http/, 'ws');
  const policy = [
    "default-src 'none'",
    // zxing 的解码器是 WebAssembly，编译它需要 wasm-unsafe-eval（不放开 JS 的 eval）。
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self'",
    `connect-src 'self' ${socketOrigin}`,
    "img-src 'self' blob: data:",
    "style-src 'self'",
    "media-src 'self' blob:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
  return {
    'Content-Security-Policy': policy,
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
}

/** 只接受 /m/ 下的相对路径；解码失败、含 .. 或反斜杠、以 / 开头的一律拒绝。 */
function toRelativePath(pathname: string): string | null {
  if (!pathname.startsWith(PAGE_PREFIX)) {
    return null;
  }
  let relative: string;
  try {
    relative = decodeURIComponent(pathname.slice(PAGE_PREFIX.length));
  } catch {
    return null;
  }
  if (relative === '') {
    return INDEX_FILE;
  }
  if (relative.startsWith('/') || relative.includes('\\') || relative.split('/').includes('..')) {
    return null;
  }
  return relative;
}

function notFound(): Response {
  return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
