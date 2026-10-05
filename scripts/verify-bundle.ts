/**
 * 校验主进程 / preload 产物没有留下包外依赖：bun run verify:bundle（在 build 之后、打包和 E2E 之前）。
 *
 * 安装包不带 node_modules，产物里多出任何一个包外模块名，就是一次还没发生的「装完启动就崩」。
 * 这类故障在开发机上永远复现不了：开发时直接从项目的 node_modules 里取，什么都找得到。
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { findExternalSpecifiers, OPTIONAL_NATIVE_MODULES } from './bundle-policy';

const BUNDLE_DIRS = ['out/main', 'out/preload'];
const ELECTRON_QUERY_TIMEOUT_MS = 30_000;
/**
 * 读表格的子进程是单独的入口（src/main/batch/reader-worker.ts），electron-vite 把它打成
 * `out/main/` 下另一个文件（文件名带哈希，例如 reader-worker-<hash>.js）。BUNDLE_DIRS 递归扫描
 * out/main 时已经会扫到它，这里额外认一次「确实扫到了」：以后这个文件挪了地方、或者构建方式变了导致
 * 它不再落在 out/main 下，这个脚本能直接报错，而不是悄悄漏掉这个子进程 bundle 的校验。
 */
const READER_WORKER_FILE_PATTERN = /reader-worker/;

/** 以 Electron 自己的 Node 为准：Bun 的内置模块名单和 Electron 的不一样。 */
function electronRuntimeModules(): Set<string> {
  const electronPath = createRequire(import.meta.url)('electron') as string;
  const output = execFileSync(
    electronPath,
    ['-e', 'console.log(JSON.stringify(require("node:module").builtinModules))'],
    { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: ELECTRON_QUERY_TIMEOUT_MS },
  );
  const builtins = JSON.parse(output.trim()) as string[];
  return new Set(['electron', ...builtins.flatMap((name) => [name, name.startsWith('node:') ? name : `node:${name}`])]);
}

function javascriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.[cm]?js$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

const runtime = electronRuntimeModules();
const optional = new Set(OPTIONAL_NATIVE_MODULES);
const isAllowed = (specifier: string) => runtime.has(specifier) || optional.has(specifier);

const files = BUNDLE_DIRS.flatMap(javascriptFiles);
let hasFailure = false;
for (const file of files) {
  const externals = findExternalSpecifiers(readFileSync(file, 'utf8'), isAllowed);
  if (externals.length === 0) {
    console.log(`ok   ${file}`);
    continue;
  }
  hasFailure = true;
  console.error(`FAIL ${file} requires modules that are not bundled: ${externals.join(', ')}`);
}

if (!files.some((file) => READER_WORKER_FILE_PATTERN.test(file))) {
  hasFailure = true;
  console.error(
    'FAIL could not find the table reader utility process bundle (out/main/reader-worker-*.js): ' +
      'the build output layout may have changed, so this run did not actually check it.',
  );
}

if (hasFailure) {
  console.error('The installer ships without node_modules: bundle these modules or add a guarded optional one.');
  process.exit(1);
}
