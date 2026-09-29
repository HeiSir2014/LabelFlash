import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { PrintJobService } from '../../core/api/print-job-service';
import type { FieldsPrint } from '../../core/print-service';
import type { ScanField } from '../../core/scan/scan-result';
import type { LabelTemplate } from '../../core/templates/template-model';
import type { Clock, PrintResult } from '../../core/types';
import type { ApiKeyInfo, CreatedApiKey, LocalApiStatus } from '../../shared/local-api';
import type { AppSettings } from '../../shared/settings';
import { SqliteApiJobStore } from '../storage/sqlite-api-job-store';
import { SqliteApiKeyStore } from '../storage/sqlite-api-key-store';
import { Authenticator } from './authenticator';
import { ConcurrencyLimit } from './concurrency-limit';
import { ApiHttpServer, DEFAULT_PORTS } from './http-server';
import { OriginPrompts } from './origin-prompts';
import { RateLimiter } from './rate-limiter';
import type { ApiPrinter } from './resources';
import { requiresCaller, route } from './router';

/** 排队中的标签总数上限：两三百张一批很常见，留出十几批的余量；更多多半是调用方程序出错在反复提交。 */
export const API_QUEUE_LIMIT = 5000;
/** 每个调用方每秒 20 个请求、可以突发 40 个：正常逐张提交、轮询状态绰绰有余。 */
const API_RATE_LIMITS = { perSecond: 20, burst: 40 };
/** 局域网来的请求在认证之前按来源地址限速：比每个调用方的限额宽一些，正常使用碰不到。 */
const API_ADDRESS_LIMITS = { perSecond: 40, burst: 80 };
/** 只排版（PDF）同时最多 2 个、再排 8 个：每个都开一个隐藏窗口（渲染进程），不能和打印抢资源。 */
const PDF_MAX_RUNNING = 2;
const PDF_MAX_QUEUED = 8;
/** 过期任务每小时清理一次：保留期是 7 天，不需要更勤。 */
const API_PURGE_INTERVAL_MS = 60 * 60_000;
/** 接口打印后通知界面刷新打印记录，最多这么久一次：一批几百张时不让界面每张都刷新。 */
const JOBS_CHANGED_COALESCE_MS = 500;

/** 新生成的密钥原文在内存里留这么久，给「复制」按钮用：够操作员复制到调用方的配置里，又不长期留着。 */
export const FRESH_SECRET_MS = 10 * 60_000;

/** 仅开发 / E2E：本机接口用这个端口（0 = 系统随便给一个），不和本机上跑着的安装版抢端口。安装版忽略它。 */
export const API_PORT_ENV = 'CDL_LABELFLASH_API_PORT';
const MAX_PORT = 65_535;

/** 没指定端口时依次尝试的端口。 */
export function apiCandidatePorts(env: NodeJS.ProcessEnv, isPackaged: boolean): readonly number[] {
  const override = isPackaged ? undefined : env[API_PORT_ENV];
  const port = override === undefined || override === '' ? Number.NaN : Number(override);
  return Number.isInteger(port) && port >= 0 && port <= MAX_PORT ? [port] : DEFAULT_PORTS;
}

/** 最后一个候选：0 = 由系统分配一个空闲端口，保证本机接口总能起来。 */
const ANY_FREE_PORT = 0;

/**
 * 依次尝试的端口：指定的 → 上次用成功的 → 默认的几个 → 系统分配的空闲端口。
 * 先用上次的，端口就不会因为重启而变来变去，局域网里已经配好这个端口的程序也就不会忽然连不上。
 */
export function apiPortOrder(
  settings: Pick<AppSettings, 'apiPort' | 'apiLastPort'>,
  candidatePorts: readonly number[],
): number[] {
  const ports = [settings.apiPort, settings.apiLastPort, ...candidatePorts, ANY_FREE_PORT];
  return [...new Set(ports.filter((port): port is number => port !== null))];
}

export interface LocalApiDeps {
  db: DatabaseSync;
  clock: Clock;
  appVersion: string;
  settings: () => AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => AppSettings;
  /** 电脑上弹框询问是否允许这个网站；返回是否允许。 */
  askOrigin: (origin: string) => Promise<boolean>;
  findTemplate: (templateId: string) => LabelTemplate | null;
  listTemplates: () => LabelTemplate[];
  installedPrinters: () => Promise<string[]>;
  listPrinters: () => Promise<ApiPrinter[]>;
  printFields: (input: FieldsPrint) => Promise<PrintResult>;
  renderPdf: (template: LabelTemplate, fields: ScanField[], content: string) => Promise<Uint8Array>;
  /** 没指定端口时依次尝试的端口（默认 17631–17633；E2E 用随机端口）。 */
  candidatePorts: readonly number[];
  findPortOwner: (port: number) => Promise<string | null>;
  lanAddresses: () => string[];
  onStatus: (status: LocalApiStatus) => void;
  /** 接口打的标签写进了打印记录：界面刷新打印记录（不播报，提交的人不在电脑前）。 */
  onJobsChanged: () => void;
}

/**
 * 本机接口：把任务服务、授权、网站授权框、HTTP 服务组装起来，跟随设置启停。
 * 不 import electron：弹框、打印机列表、PDF 都由主进程传入，这里可以用 bun test 整体测试。
 */
export class LocalApi {
  readonly jobs: PrintJobService;
  private readonly keys: SqliteApiKeyStore;
  private readonly server: ApiHttpServer;
  private readonly prompts: OriginPrompts;
  private readonly pdfLimit = new ConcurrencyLimit(PDF_MAX_RUNNING, PDF_MAX_QUEUED);
  private portOwner: string | null = null;
  private purgeTimer: ReturnType<typeof setInterval> | null = null;
  private jobsChangedTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly freshSecrets = new Map<string, { secret: string; expiresAt: number }>();

  constructor(private readonly deps: LocalApiDeps) {
    this.keys = new SqliteApiKeyStore(deps.db, deps.clock);
    this.jobs = new PrintJobService({
      store: new SqliteApiJobStore(deps.db),
      clock: deps.clock,
      createId: randomUUID,
      findTemplate: deps.findTemplate,
      installedPrinters: deps.installedPrinters,
      printFields: async (input) => {
        const result = await deps.printFields(input);
        this.jobsChanged();
        return result;
      },
      queueLimit: API_QUEUE_LIMIT,
    });
    this.prompts = new OriginPrompts({
      clock: deps.clock,
      ask: deps.askOrigin,
      grant: (origin) => this.grantOrigin(origin),
    });
    const isOriginAuthorized = (origin: string) => deps.settings().apiAuthorizedOrigins.includes(origin);
    this.server = new ApiHttpServer({
      authenticator: new Authenticator({
        findKeyByHash: (hash) => this.keys.findByHash(hash),
        hasAnyKey: () => this.keys.hasAny(),
        isOriginAuthorized,
        requestOrigin: (origin) => this.prompts.request(origin),
        touchKey: (id) => this.keys.touch(id),
      }),
      rateLimiter: new RateLimiter(deps.clock, API_RATE_LIMITS),
      addressLimiter: new RateLimiter(deps.clock, API_ADDRESS_LIMITS),
      isOriginAuthorized,
      requiresCaller,
      handle: (request) =>
        route(
          {
            jobs: this.jobs,
            listTemplates: deps.listTemplates,
            findTemplate: deps.findTemplate,
            listPrinters: deps.listPrinters,
            renderPdf: (template, fields, content) =>
              this.pdfLimit.run(() => deps.renderPdf(template, fields, content)),
            service: { version: deps.appVersion, port: () => this.server.port() ?? 0 },
          },
          request,
        ),
    });
  }

  /** 启动时调用一次：先收尾上次没打完的任务，再开始监听。 */
  async start(): Promise<void> {
    this.jobs.recoverInterrupted();
    this.jobs.purge();
    this.purgeTimer = setInterval(() => this.jobs.purge(), API_PURGE_INTERVAL_MS);
    await this.listen();
  }

  async stop(): Promise<void> {
    if (this.purgeTimer !== null) {
      clearInterval(this.purgeTimer);
      this.purgeTimer = null;
    }
    if (this.jobsChangedTimer !== null) {
      clearTimeout(this.jobsChangedTimer);
      this.jobsChangedTimer = null;
    }
    await this.server.stop();
  }

  async settingsChanged(next: AppSettings, previous: AppSettings): Promise<void> {
    if (next.apiPort === null && previous.apiPort !== null) {
      // 清空指定的端口就是回到默认端口：忘掉记住的那个（它多半就是刚才指定的）。
      this.deps.updateSettings({ apiLastPort: null });
    }
    if (next.apiPort !== previous.apiPort || next.apiLanEnabled !== previous.apiLanEnabled) {
      await this.listen();
    } else if (JSON.stringify(next.apiAuthorizedOrigins) !== JSON.stringify(previous.apiAuthorizedOrigins)) {
      this.publish();
    }
  }

  status(): LocalApiStatus {
    return {
      server: this.server.status,
      lanAddresses: this.deps.lanAddresses(),
      portOwner: this.portOwner,
      authorizedOrigins: this.deps.settings().apiAuthorizedOrigins,
    };
  }

  listKeys(): ApiKeyInfo[] {
    return this.keys.list();
  }

  createKey(name: string): CreatedApiKey {
    const created = this.keys.create(name);
    this.freshSecrets.set(created.key.id, {
      secret: created.secret,
      expiresAt: this.deps.clock.now() + FRESH_SECRET_MS,
    });
    return created;
  }

  /** 刚生成的密钥原文（给「复制」按钮）；过了 FRESH_SECRET_MS 或密钥已撤销时为 null。 */
  freshSecret(id: string): string | null {
    const fresh = this.freshSecrets.get(id);
    if (fresh === undefined || this.deps.clock.now() >= fresh.expiresAt) {
      this.freshSecrets.delete(id);
      return null;
    }
    return fresh.secret;
  }

  renameKey(id: string, name: string): void {
    this.keys.rename(id, name);
  }

  removeKey(id: string): void {
    this.keys.remove(id);
    this.freshSecrets.delete(id);
  }

  revokeOrigin(origin: string): void {
    const origins = this.deps.settings().apiAuthorizedOrigins;
    this.deps.updateSettings({ apiAuthorizedOrigins: origins.filter((item) => item !== origin) });
    this.publish();
  }

  private grantOrigin(origin: string): void {
    const origins = this.deps.settings().apiAuthorizedOrigins;
    if (!origins.includes(origin)) {
      this.deps.updateSettings({ apiAuthorizedOrigins: [...origins, origin] });
    }
    this.publish();
  }

  private async listen(): Promise<void> {
    const settings = this.deps.settings();
    const status = await this.server.start({
      lanEnabled: settings.apiLanEnabled,
      ports: apiPortOrder(settings, this.deps.candidatePorts),
    });
    this.portOwner = null;
    if (status.state === 'failed') {
      console.warn(`[api] not started: ports ${status.ports.join(', ')} are unavailable`);
    } else if (status.state === 'listening') {
      const where = status.lanEnabled ? ' (LAN)' : ' (this computer only)';
      const skipped = status.skippedPorts.length > 0 ? `, skipped taken ports ${status.skippedPorts.join(', ')}` : '';
      console.info(`[api] listening on port ${status.port}${where}${skipped}`);
      if (status.port !== settings.apiLastPort) {
        this.deps.updateSettings({ apiLastPort: status.port });
      }
    }
    // 首选的端口被占用时查一下是谁：界面上说清楚「被某某占用，已改用某端口」。
    const [preferred] =
      status.state === 'failed' ? status.ports : status.state === 'listening' ? status.skippedPorts : [];
    if (preferred !== undefined && preferred !== ANY_FREE_PORT) {
      this.portOwner = await this.deps.findPortOwner(preferred);
    }
    this.publish();
  }

  private publish(): void {
    this.deps.onStatus(this.status());
  }

  private jobsChanged(): void {
    this.jobsChangedTimer ??= setTimeout(() => {
      this.jobsChangedTimer = null;
      this.deps.onJobsChanged();
    }, JOBS_CHANGED_COALESCE_MS);
  }
}
