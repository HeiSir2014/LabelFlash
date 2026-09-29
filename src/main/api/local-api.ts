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
import { ApiHttpServer } from './http-server';
import { OriginPrompts } from './origin-prompts';
import { RateLimiter } from './rate-limiter';
import type { ApiPrinter } from './resources';
import { requiresCaller, route } from './router';

/** 排队中的标签总数上限：两三百张一批很常见，留出十几批的余量；更多多半是调用方程序出错在反复提交。 */
export const API_QUEUE_LIMIT = 5000;
/** 每个调用方每秒 20 个请求、可以突发 40 个：正常逐张提交、轮询状态绰绰有余。 */
const API_RATE_LIMITS = { perSecond: 20, burst: 40 };
/** 过期任务每小时清理一次：保留期是 7 天，不需要更勤。 */
const API_PURGE_INTERVAL_MS = 60 * 60_000;
/** 接口打印后通知界面刷新打印记录，最多这么久一次：一批几百张时不让界面每张都刷新。 */
const JOBS_CHANGED_COALESCE_MS = 500;

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
  private portOwner: string | null = null;
  private purgeTimer: ReturnType<typeof setInterval> | null = null;
  private jobsChangedTimer: ReturnType<typeof setTimeout> | null = null;

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
      isOriginAuthorized,
      requiresCaller,
      handle: (request) =>
        route(
          {
            jobs: this.jobs,
            listTemplates: deps.listTemplates,
            findTemplate: deps.findTemplate,
            listPrinters: deps.listPrinters,
            renderPdf: deps.renderPdf,
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
    return this.keys.create(name);
  }

  renameKey(id: string, name: string): void {
    this.keys.rename(id, name);
  }

  removeKey(id: string): void {
    this.keys.remove(id);
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
      port: settings.apiPort,
      candidatePorts: this.deps.candidatePorts,
    });
    this.portOwner = null;
    if (status.state === 'failed') {
      console.warn(`[api] not started: ports ${status.ports.join(', ')} are unavailable`);
      const [first] = status.ports;
      this.portOwner = first === undefined ? null : await this.deps.findPortOwner(first);
    } else if (status.state === 'listening') {
      console.info(`[api] listening on port ${status.port}${status.lanEnabled ? ' (LAN)' : ' (this computer only)'}`);
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
