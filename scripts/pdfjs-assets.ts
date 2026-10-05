import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

/**
 * pdf.js 运行时按需读取的文件：字符映射（中文等非嵌入字体要用）、PDF 标准 14 种字体、图像解码器（wasm）、
 * 颜色转换用的 ICC 配置文件。都从安装包里读，渲染页不连网。
 */
export const PDFJS_ASSET_DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs'] as const;
/** 在渲染进程产物里的位置：app://bundle/pdfjs/<目录>/<文件>，渲染页按这个固定路径读。 */
export const PDFJS_ASSET_BASE = 'pdfjs';
/**
 * 不放进产物的文件：quickjs-eval（.wasm 和它的 .js 胶水）是执行 PDF 里嵌的 JavaScript 用的。我们不开脚本（只画页面），
 * 不带它就不会有哪条路径意外跑起 PDF 自带的脚本。
 */
const EXCLUDED_ASSET_PREFIX = 'quickjs';

export interface AssetFile {
  /** 产物里的路径。 */
  fileName: string;
  /** 源文件。 */
  path: string;
}

/** 这几个目录里的文件（不进子目录），一一对应到产物里的固定路径。 */
export function pdfjsAssetFiles(packageDir: string): AssetFile[] {
  return PDFJS_ASSET_DIRS.flatMap((dir) =>
    readdirSync(join(packageDir, dir), { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith(EXCLUDED_ASSET_PREFIX))
      .map((entry) => ({
        fileName: `${PDFJS_ASSET_BASE}/${dir}/${entry.name}`,
        path: join(packageDir, dir, entry.name),
      })),
  );
}

export function pdfjsPackageDir(): string {
  return dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
}

/**
 * 构建渲染进程时把 pdf.js 的运行时文件原样放进产物（不打包、不改名）；开发服务器上按同样的路径提供。
 * 自己写这几行，不为复制文件引入新的插件依赖。
 */
export function pdfjsAssets(): Plugin {
  return {
    name: 'labelflash-pdfjs-assets',
    configureServer(server) {
      const files = new Map(pdfjsAssetFiles(pdfjsPackageDir()).map((file) => [`/${file.fileName}`, file.path]));
      server.middlewares.use((request, response, next) => {
        const path = files.get((request.url ?? '').split('?')[0] ?? '');
        if (path === undefined) {
          next();
          return;
        }
        response.setHeader('Content-Type', path.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
        response.end(readFileSync(path));
      });
    },
    generateBundle() {
      for (const file of pdfjsAssetFiles(pdfjsPackageDir())) {
        this.emitFile({ type: 'asset', fileName: file.fileName, source: readFileSync(file.path) });
      }
    },
  };
}
