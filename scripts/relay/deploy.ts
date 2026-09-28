/**
 * 发布中转服务到一台装了 Docker 的服务器（经 ssh）。目标服务器从环境变量读取，仓库里不写任何服务器信息：
 *
 *   RELAY_DEPLOY_SSH     ssh 主机名（~/.ssh/config 里的别名）
 *   RELAY_PUBLIC_ORIGIN  扫码页对外的 origin，传给容器的 PUBLIC_ORIGIN，例如 https://relay.example.com
 *   RELAY_HEALTH_URL     对外的健康检查地址，例如 https://relay.example.com/labelflash/healthz
 *
 * 步骤：本机构建 → 打包上传到 ~/labelflash-relay/<版本>/ → docker build → 替换容器 → 服务器本机和对外各检查一次健康；
 * 失败就换回上一个镜像。只保留最近两个版本的镜像和目录。反向代理的配置只改一次，见 relay/deploy/nginx-location.conf。
 *
 * 用法：bun run relay:deploy
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildRelay, relayVersion } from './build';

export const CONTAINER_NAME = 'labelflash-relay';
const IMAGE_NAME = 'labelflash-relay';
const REMOTE_DIR = '~/labelflash-relay';
/** 和 relay/src/config.ts 的默认端口一致；只映射到宿主机的 127.0.0.1，由反向代理对外。 */
const RELAY_PORT = 3180;
/** 128 MB 足够几百个连接（每个只占几 KB），同时不让它挤占同一台服务器上的其他服务。 */
const MEMORY_LIMIT = '128m';
/** 日志轮转：两份各 5 MB，只记连接事件，够排查问题又不占磁盘。 */
const LOG_MAX_SIZE = '5m';
const LOG_MAX_FILES = 2;
/** 新容器启动后，健康检查最多等这么久。 */
const HEALTH_WAIT_SECONDS = 20;
/** ssh 主机名只允许字母、数字、点、横线、下划线：它会出现在命令行里，不能夹带参数或命令。 */
const SSH_HOST_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const ROOT = resolve(import.meta.dir, '../..');

export interface DeployTarget {
  ssh: string;
  publicOrigin: string;
  healthUrl: string;
}

export function readDeployTarget(env: Record<string, string | undefined>): DeployTarget {
  const read = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) {
      throw new Error(`缺少环境变量 ${name}，见 scripts/relay/deploy.ts 开头的说明`);
    }
    return value;
  };
  const ssh = read('RELAY_DEPLOY_SSH');
  if (!SSH_HOST_PATTERN.test(ssh)) {
    throw new Error(`RELAY_DEPLOY_SSH 只能是 ssh 主机名：「${ssh}」`);
  }
  return { ssh, publicOrigin: read('RELAY_PUBLIC_ORIGIN'), healthUrl: read('RELAY_HEALTH_URL') };
}

/** 构建版本（例如 1.1.0+abc1234）→ docker 标签（不允许 +）。 */
export function imageTag(version: string): string {
  return version.replaceAll('+', '-');
}

export function dockerRunArgs(tag: string, publicOrigin: string): string[] {
  return [
    'run',
    '--detach',
    '--name',
    CONTAINER_NAME,
    '--restart',
    'unless-stopped',
    '--publish',
    `127.0.0.1:${RELAY_PORT}:${RELAY_PORT}`,
    '--memory',
    MEMORY_LIMIT,
    // 中转服务不写磁盘：文件系统只读，只给 Bun 留一个临时目录。
    '--read-only',
    '--tmpfs',
    '/tmp',
    '--user',
    'bun',
    '--log-opt',
    `max-size=${LOG_MAX_SIZE}`,
    '--log-opt',
    `max-file=${LOG_MAX_FILES}`,
    '--env',
    `PUBLIC_ORIGIN=${publicOrigin}`,
    `${IMAGE_NAME}:${tag}`,
  ];
}

/** 在服务器上执行一段 sh 脚本；失败时抛出带输出的错误。 */
async function remote(target: DeployTarget, script: string): Promise<string> {
  const child = Bun.spawn(['ssh', '-o', 'BatchMode=yes', target.ssh, script], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`服务器上的命令失败（退出码 ${exitCode}）：\n${stderr || stdout}`);
  }
  return stdout.trim();
}

async function run(command: string[]): Promise<void> {
  const child = Bun.spawn(command, { stdout: 'inherit', stderr: 'inherit' });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`${command[0]} 失败（退出码 ${exitCode}）`);
  }
}

/** sh 单引号转义：参数原样传给服务器上的 docker，不被 shell 解释。 */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function checkPublicHealth(url: string, version: string): Promise<void> {
  const response = await fetch(url);
  const health = (await response.json()) as { ok?: boolean; version?: string };
  if (!response.ok || health.ok !== true || health.version !== version) {
    throw new Error(`对外的健康检查不对：${response.status} ${JSON.stringify(health)}，期望版本 ${version}`);
  }
}

export async function deploy(target: DeployTarget): Promise<void> {
  const version = await relayVersion();
  const tag = imageTag(version);
  const workDir = await mkdtemp(join(tmpdir(), 'relay-deploy-'));
  try {
    const stage = join(workDir, 'stage');
    await buildRelay({ outDir: join(stage, 'dist'), version });
    await Bun.write(join(stage, 'Dockerfile'), Bun.file(join(ROOT, 'relay', 'Dockerfile')));
    const archive = join(workDir, 'relay.tgz');
    await run(['tar', '-czf', archive, '-C', stage, 'dist', 'Dockerfile']);

    const dir = `${REMOTE_DIR}/${tag}`;
    await remote(target, `mkdir -p ${dir}`);
    await run(['scp', '-o', 'BatchMode=yes', '-q', archive, `${target.ssh}:${dir}/relay.tgz`]);
    console.log(`uploaded ${tag}`);

    const previous = await remote(target, `cat ${REMOTE_DIR}/current 2>/dev/null || true`);
    await remote(target, `cd ${dir} && tar -xzf relay.tgz && docker build --quiet --tag ${IMAGE_NAME}:${tag} .`);
    const runArgs = (runTag: string) => dockerRunArgs(runTag, target.publicOrigin).map(shellQuote).join(' ');
    await remote(target, `docker rm --force ${CONTAINER_NAME} >/dev/null 2>&1 || true; docker ${runArgs(tag)}`);

    const healthScript = [
      `for i in $(seq ${HEALTH_WAIT_SECONDS}); do`,
      `  if curl -fsS http://127.0.0.1:${RELAY_PORT}/healthz | grep -q ${shellQuote(`"version":"${version}"`)}; then exit 0; fi`,
      '  sleep 1',
      'done',
      'exit 1',
    ].join('\n');
    try {
      await remote(target, healthScript);
      await checkPublicHealth(target.healthUrl, version);
    } catch (error) {
      if (previous) {
        console.error(`新版本没有通过健康检查，换回 ${previous}`);
        await remote(
          target,
          `docker rm --force ${CONTAINER_NAME} >/dev/null 2>&1 || true; docker ${runArgs(previous)}`,
        );
      }
      throw error;
    }

    // 记下当前版本，只保留最近两个版本的目录和镜像。
    await remote(
      target,
      [
        `echo ${shellQuote(tag)} > ${REMOTE_DIR}/current`,
        `cd ${REMOTE_DIR} && ls -1dt */ | tail -n +3 | while read old; do`,
        // \${old%/} 是 sh 的写法：去掉目录名结尾的 /，得到版本标签。
        `  docker image rm --force "${IMAGE_NAME}:\${old%/}" >/dev/null 2>&1 || true`,
        '  rm -rf -- "$old"',
        'done',
      ].join('\n'),
    );
    console.log(`relay ${version} is live at ${target.healthUrl}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  await deploy(readDeployTarget(process.env));
}
