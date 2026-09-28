import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { OPTIONAL_NATIVE_MODULES } from './scripts/bundle-policy';

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
export default defineConfig({
  main: {
    build: {
      externalizeDeps: false,
      rollupOptions: { external: [...OPTIONAL_NATIVE_MODULES], output: { format: 'cjs' } },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].js' } },
    },
  },
  renderer: {
    plugins: [react()],
  },
});
