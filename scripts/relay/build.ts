/**
 * 构建中转服务：服务端 bundle（server.js）和扫码页（web/）。
 *
 * 扫码页的脚本、样式、wasm 都带内容哈希放在 web/assets/，可以永久缓存；index.html 每次都向服务器确认。
 * 所有文件都由中转服务自己提供，不引用任何第三方地址（CSP 也不允许）。
 *
 * 用法：bun scripts/relay/build.ts [输出目录]，默认 relay/dist。
 */
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, parse, resolve, sep } from 'node:path';
import { BRAND } from '../../src/shared/brand';
import { MAX_REQUEST_RAW_LENGTH } from '../../src/shared/mobile-protocol';

const ROOT = resolve(import.meta.dir, '../..');
const WEB_SOURCE = join(ROOT, 'relay', 'web');
const DEFAULT_OUT_DIR = join(ROOT, 'relay', 'dist');
/** 版本号里标记「工作区有没提交的改动」。 */
export const DIRTY_SUFFIX = '.dirty';
const READER_WASM = join(ROOT, 'node_modules', 'zxing-wasm', 'dist', 'reader', 'zxing_reader.wasm');
/** 文件名里的哈希位数：8 位十六进制在几十个文件里不会撞。 */
const HASH_LENGTH = 8;

export interface RelayBuildOptions {
  outDir: string;
  version: string;
}

export async function buildRelay({ outDir, version }: RelayBuildOptions): Promise<void> {
  const assetsDir = join(outDir, 'web', 'assets');
  await assertSafeOutDir(outDir);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(assetsDir, { recursive: true });

  const wasmName = await copyHashed(READER_WASM, assetsDir, 'reader', '.wasm');
  const styleName = await copyHashed(join(WEB_SOURCE, 'styles.css'), assetsDir, 'styles', '.css');
  // worker 和页面脚本在同一个目录里，wasm 的地址相对 worker 自己。
  const workerName = await bundleBrowser(join(WEB_SOURCE, 'src', 'decode-worker.ts'), assetsDir, {
    READER_WASM_URL: JSON.stringify(wasmName),
  });
  // 页面在 m/，worker 在 m/assets/：地址相对页面。
  const mainName = await bundleBrowser(join(WEB_SOURCE, 'src', 'main.ts'), assetsDir, {
    DECODE_WORKER_URL: JSON.stringify(`assets/${workerName}`),
  });

  const template = await readFile(join(WEB_SOURCE, 'index.html'), 'utf8');
  const html = template
    .replaceAll('{{productName}}', escapeHtml(BRAND.productName))
    .replaceAll('{{brandMark}}', escapeHtml(BRAND.mark))
    .replaceAll('{{maxRawLength}}', String(MAX_REQUEST_RAW_LENGTH))
    .replace('href="styles.css"', `href="assets/${styleName}"`)
    .replace('src="app.js"', `src="assets/${mainName}"`);
  await writeFile(join(outDir, 'web', 'index.html'), html);

  await bundleServer(outDir, version);
}

async function bundleBrowser(entry: string, outDir: string, define: Record<string, string>): Promise<string> {
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: outDir,
    target: 'browser',
    format: 'esm',
    minify: true,
    naming: '[name]-[hash].[ext]',
    define,
  });
  return singleOutput(result, entry);
}

async function bundleServer(outDir: string, version: string): Promise<void> {
  const entry = join(ROOT, 'relay', 'src', 'main.ts');
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: outDir,
    target: 'bun',
    format: 'esm',
    naming: 'server.js',
    define: { RELAY_VERSION: JSON.stringify(version) },
  });
  singleOutput(result, entry);
}

function singleOutput(result: Awaited<ReturnType<typeof Bun.build>>, entry: string): string {
  const [output, ...extra] = result.outputs;
  if (!result.success || !output || extra.length > 0) {
    const logs = result.logs.map((log) => String(log)).join('\n');
    throw new Error(`构建 ${entry} 失败：应该只产出一个文件，实际 ${result.outputs.length} 个\n${logs}`);
  }
  return basename(output.path);
}

async function copyHashed(source: string, outDir: string, name: string, extension: string): Promise<string> {
  const hash = new Bun.CryptoHasher('sha256')
    .update(await readFile(source))
    .digest('hex')
    .slice(0, HASH_LENGTH);
  const fileName = `${name}-${hash}${extension}`;
  await copyFile(source, join(outDir, fileName));
  return fileName;
}

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/**
 * 构建前清空输出目录，所以先确认它是构建产物的目录：
 * 仓库里只允许 relay/dist；仓库外只允许不存在、空的，或者一看就是上次构建的产物（有 server.js 和 web/）。
 * 传错参数（例如 `bun scripts/relay/build.ts src`）时报错，而不是把源码删掉。
 */
export async function assertSafeOutDir(outDir: string): Promise<void> {
  const target = resolve(outDir);
  const inRepo = target === ROOT || target.startsWith(ROOT + sep);
  if (inRepo) {
    if (target !== DEFAULT_OUT_DIR && !target.startsWith(DEFAULT_OUT_DIR + sep)) {
      throw new Error(`输出目录只能在 relay/dist 下：${target}`);
    }
    return;
  }
  if (ROOT.startsWith(target + sep) || target === parse(target).root) {
    throw new Error(`输出目录不能是仓库的上级目录或磁盘根目录：${target}`);
  }
  const entries = await readdir(target).catch(() => [] as string[]);
  const isPreviousBuild = entries.includes('server.js') && entries.includes('web');
  if (entries.length > 0 && !isPreviousBuild) {
    throw new Error(`输出目录不是空的，也不像上次的构建产物，不会清空它：${target}`);
  }
}

/**
 * package.json 的版本加 git 短哈希，部署时据此确认新版本已经在运行。
 * 工作区有没提交的改动时加上 .dirty：这样的版本号对不上任何提交，发布脚本会拒绝它。
 */
export async function relayVersion(): Promise<string> {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as { version: string };
  const git = Bun.spawnSync(['git', 'rev-parse', '--short', 'HEAD'], { cwd: ROOT });
  const commit = git.exitCode === 0 ? git.stdout.toString().trim() : 'nogit';
  const status = Bun.spawnSync(['git', 'status', '--porcelain'], { cwd: ROOT });
  const isDirty = status.exitCode !== 0 || status.stdout.toString().trim() !== '';
  return `${pkg.version}+${commit}${isDirty ? DIRTY_SUFFIX : ''}`;
}

if (import.meta.main) {
  const outDir = resolve(process.argv[2] ?? DEFAULT_OUT_DIR);
  const version = await relayVersion();
  await buildRelay({ outDir, version });
  console.log(`relay ${version} built to ${outDir}`);
}
