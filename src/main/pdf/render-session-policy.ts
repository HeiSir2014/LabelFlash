import { APP_HOST, APP_SCHEME } from '../bundle-path';

/**
 * PDF 渲染页的内容安全策略：src/renderer/pdf-render.html 的 meta 写的是同一句（测试核对一字不差）。
 * 这一份由渲染页会话的 app:// 协议随每个响应头发出：pdf.js 的 worker 是单独的脚本，不继承页面的 meta，
 * 不加响应头它就没有任何限制。wasm-unsafe-eval 只许编译 WebAssembly（图像解码器），不许 eval 脚本。
 */
export const PDF_RENDER_CSP =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data: blob:; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'";

/**
 * PDF 渲染页的会话放行哪些请求：只许读本程序的文件（app://bundle/），以及 pdf.js 在页内生成的 data:、blob:（字体、图片，不出本机）。
 * 开发版另外放行本机的开发服务器（页面和热更新）。其余一律拦下：被攻破的渲染页也连不了网、读不了本机文件。
 */
export function isAllowedRenderRequest(url: string, devServerUrl: string | null): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === `${APP_SCHEME}:`) {
    return parsed.host === APP_HOST;
  }
  if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') {
    return true;
  }
  if (devServerUrl === null) {
    return false;
  }
  const dev = new URL(devServerUrl);
  return (parsed.protocol === 'http:' || parsed.protocol === 'ws:') && parsed.host === dev.host;
}
