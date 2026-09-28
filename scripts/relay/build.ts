/**
 * 构建中转服务：服务端 bundle（server.js）和扫码页（web/）。
 *
 * 扫码页的脚本、样式、wasm 都带内容哈希放在 web/assets/，可以永久缓存；index.html 每次都向服务器确认。
 * 所有文件都由中转服务自己提供，不引用任何第三方地址（CSP 也不允许）。
 *
 * 用法：bun scripts/relay/build.ts [输出目录]，默认 relay/dist。
 */
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { BRAND } from '../../src/shared/brand';

const ROOT = resolve(import.meta.dir, '../..');
const WEB_SOURCE = join(ROOT, 'relay', 'web');
const READER_WASM = join(ROOT, 'node_modules', 'zxing-wasm', 'dist', 'reader', 'zxing_reader.wasm');
/** 文件名里的哈希位数：8 位十六进制在几十个文件里不会撞。 */
const HASH_LENGTH = 8;

export interface RelayBuildOptions {
  outDir: string;
  version: string;
}

export async function buildRelay({ outDir, version }: RelayBuildOptions): Promise<void> {
  const assetsDir = join(outDir, 'web', 'assets');
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

/** package.json 的版本加 git 短哈希，部署时据此确认新版本已经在运行。 */
export async function relayVersion(): Promise<string> {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as { version: string };
  const git = Bun.spawnSync(['git', 'rev-parse', '--short', 'HEAD'], { cwd: ROOT });
  const commit = git.exitCode === 0 ? git.stdout.toString().trim() : 'nogit';
  return `${pkg.version}+${commit}`;
}

if (import.meta.main) {
  const outDir = resolve(process.argv[2] ?? join(ROOT, 'relay', 'dist'));
  const version = await relayVersion();
  await buildRelay({ outDir, version });
  console.log(`relay ${version} built to ${outDir}`);
}
