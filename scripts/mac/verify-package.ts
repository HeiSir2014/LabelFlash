/**
 * 检查 macOS 安装包：bun run dist:mac 的最后一步，只能在 macOS 上运行。
 *
 * 打出来的包在 CI 上没人去装，坏了要到用户那里才发现：Apple 芯片上没签名的程序打不开、
 * 只有一种架构的程序在另一种 Mac 上打不开、装到了别的地方。这里把这几件事在打包后逐一核对。
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasPostinstallScript, installLocation, isAdHocSigned, missingArchitectures } from './package-checks';

const DIST_DIR = 'dist';
const APP_DIR = join(DIST_DIR, 'mac-universal');
const EXPECTED_INSTALL_LOCATION = '/Applications';

interface CommandResult {
  exitCode: number;
  output: string;
}

/** 系统命令一律用参数数组调用；codesign 把信息写到 stderr，所以两路一起收。 */
function run(command: string[]): CommandResult {
  const result = Bun.spawnSync(command, { stdout: 'pipe', stderr: 'pipe' });
  return { exitCode: result.exitCode, output: `${result.stdout.toString()}${result.stderr.toString()}` };
}

function onlyEntry(directory: string, matches: (name: string) => boolean, what: string): string {
  const names = readdirSync(directory).filter(matches);
  if (names.length !== 1) {
    throw new Error(`${directory} 里应该正好有一个${what}，实际有 ${names.length} 个：${names.join(', ')}`);
  }
  return join(directory, names[0] as string);
}

const failures: string[] = [];
function check(name: string, passed: boolean, detail: string): void {
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${name}${passed ? '' : `：${detail}`}`);
  if (!passed) {
    failures.push(name);
  }
}

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
const pkg = join(DIST_DIR, `CDL-LabelFlash-${version}.pkg`);
const app = onlyEntry(APP_DIR, (name) => name.endsWith('.app'), ' .app');
const executable = onlyEntry(join(app, 'Contents', 'MacOS'), () => true, '可执行文件');

const verify = run(['codesign', '--verify', '--deep', '--strict', app]);
check('signature is intact', verify.exitCode === 0, verify.output.trim());

const display = run(['codesign', '-dv', app]);
check('signed ad-hoc', isAdHocSigned(display.output), display.output.trim());

const archs = run(['lipo', '-archs', executable]);
const missing = missingArchitectures(archs.output);
check(
  'universal binary',
  archs.exitCode === 0 && missing.length === 0,
  `缺少 ${missing.join(', ')}（${archs.output.trim()}）`,
);

const expanded = join(mkdtempSync(join(tmpdir(), 'labelflash-pkg-')), 'expanded');
try {
  const expand = run(['pkgutil', '--expand', pkg, expanded]);
  const expandedPaths = expand.exitCode === 0 ? readdirSync(expanded, { recursive: true, encoding: 'utf8' }) : [];
  const packageInfos = expandedPaths.filter((path) => path.endsWith('PackageInfo'));
  const locations = packageInfos.map((path) => installLocation(readFileSync(join(expanded, path), 'utf8')));
  check(
    `installs into ${EXPECTED_INSTALL_LOCATION}`,
    locations.length > 0 && locations.every((location) => location === EXPECTED_INSTALL_LOCATION),
    expand.exitCode === 0 ? `安装位置是 ${locations.join(', ') || '（没有写）'}` : expand.output.trim(),
  );
  check('runs the postinstall script', hasPostinstallScript(expandedPaths), '安装包里没有 Scripts/postinstall');
} finally {
  rmSync(join(expanded, '..'), { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`${pkg} 没通过检查：${failures.join('、')}`);
  process.exit(1);
}
console.log(`${pkg} 通过检查`);
