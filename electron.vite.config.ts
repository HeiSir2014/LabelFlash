import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { OPTIONAL_NATIVE_MODULES } from './scripts/bundle-policy';
import { pdfjsAssets } from './scripts/pdfjs-assets';

/**
 * 主进程和 preload 都打成自包含的单文件 bundle：除了 electron 和 Node 内置模块，依赖全部内联。
 * 这样安装包里不需要 node_modules，也就不会出现「开发时正常、安装后启动报 Cannot find module」——
 * 那类故障的根因总是某个传递依赖没被打包工具收集到，而它在开发机上永远复现不了。
 * 构建后由 scripts/verify-bundle.ts 确认产物确实没有包外依赖。
 *
 * 产物固定为 CommonJS、文件名固定为 index.js：sandbox 下的 preload 必须是 CommonJS，
 * window.ts 里写死了 ../preload/index.js。
 * 唯一的例外是 OPTIONAL_NATIVE_MODULES，理由见 scripts/bundle-policy.ts。
 */
/**
 * 手机扫码的默认中转地址，构建时从环境变量注入（代码里不写域名）：官方安装包由 CI 从 Actions 变量传入，
 * 自己构建时不设就没有默认值，要在配置中心里填写。见 src/main/mobile/build-defaults.ts。
 */
const DEFAULT_RELAY_URL_ENV = 'CDL_LABELFLASH_DEFAULT_RELAY_URL';
/**
 * CI 的构建号：electron-builder 从同一个环境变量 BUILD_NUMBER 读取，写进文件版本；这里注入给「关于」和日志。
 * 见 src/main/build-info.ts。
 */
const BUILD_NUMBER_ENV = 'BUILD_NUMBER';

export default defineConfig({
  main: {
    define: {
      [DEFAULT_RELAY_URL_ENV]: JSON.stringify(process.env[DEFAULT_RELAY_URL_ENV] ?? ''),
      CDL_LABELFLASH_BUILD_NUMBER: JSON.stringify(process.env[BUILD_NUMBER_ENV] ?? ''),
    },
    build: {
      externalizeDeps: false,
      rollupOptions: { external: [...OPTIONAL_NATIVE_MODULES], output: { format: 'cjs' } },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        // 第二个 preload 给隐藏的 PDF 渲染页（只有收请求、回结果两个函数），同样打成自包含的 CommonJS。
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          'pdf-render': resolve(__dirname, 'src/preload/pdf-render.ts'),
        },
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    plugins: [react(), pdfjsAssets()],
    build: {
      rollupOptions: {
        // 第二个页面是隐藏的 PDF 渲染页（只有 pdf.js，没有界面）。
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          'pdf-render': resolve(__dirname, 'src/renderer/pdf-render.html'),
        },
      },
    },
  },
});
