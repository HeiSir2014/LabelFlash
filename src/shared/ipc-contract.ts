import type { LookupTableInfo } from '../core/lookup/lookup-model';
import type { Delivery } from '../core/notify/delivery';
import type { RuleKind, ScanRule } from '../core/scan/rule-model';
import type { RuleSetting } from '../core/scan/rule-settings';
import type { LabelTemplate } from '../core/templates/template-model';
import type { PreviewResult, PrinterInfo, PrintResult } from '../core/types';
import type { PaperCheck } from './driver-paper';
import type { JobPage, JobQuery } from './job-history';
import type { PrinterReadiness } from './printer-readiness';
import type { RuleExportResult, RuleImportResult, RuleListing, RuleMutation, RuleTestResult } from './rule-api';
import type { AppSettings } from './settings';
import type { UpdateStatus } from './update-status';
import type { VoiceCue } from './voice';
import type { WindowChrome } from './window-chrome';

export const IpcChannel = {
  Preview: 'label:preview',
  PreviewTemplate: 'label:preview-template',
  Print: 'label:print',
  PrintTest: 'printer:test',
  ListPrinters: 'printer:list',
  PrinterStatus: 'printer:status',
  CheckDriverPaper: 'printer:driver-paper',
  OpenPrinterPreferences: 'printer:open-preferences',
  ListJobs: 'jobs:list',
  GetSettings: 'settings:get',
  UpdateSettings: 'settings:update',
  ListTemplates: 'templates:list',
  DuplicateTemplate: 'templates:duplicate',
  SaveTemplate: 'templates:save',
  DeleteTemplate: 'templates:delete',
  ListRules: 'rules:list',
  CreateRule: 'rules:create',
  DuplicateRule: 'rules:duplicate',
  SaveRule: 'rules:save',
  DeleteRule: 'rules:delete',
  SaveRuleSettings: 'rules:save-settings',
  TestRule: 'rules:test',
  ExportRules: 'rules:export',
  ImportRules: 'rules:import',
  ListLookupTables: 'lookup:list',
  ImportLookupTable: 'lookup:import',
  DeleteLookupTable: 'lookup:delete',
  ListSecrets: 'secrets:list',
  SetSecret: 'secrets:set',
  DeleteSecret: 'secrets:delete',
  ListWebhookDeliveries: 'webhooks:deliveries',
  RetryWebhookDelivery: 'webhooks:retry',
  SendTestWebhook: 'webhooks:test',
  GetAppInfo: 'app:info',
  OpenLogFolder: 'app:open-log-folder',
  OpenShop: 'app:open-shop',
  GetUpdateStatus: 'update:status',
  CheckForUpdates: 'update:check',
  InstallUpdate: 'update:install',
  UpdateStatusChanged: 'update:status-changed',
  VoiceClip: 'voice:clip',
  WindowMinimize: 'window:minimize',
  WindowToggleMaximize: 'window:toggle-maximize',
  WindowClose: 'window:close',
  WindowMaximizedChanged: 'window:maximized-changed',
  WindowFullScreenChanged: 'window:full-screen-changed',
} as const;

/** 渲染进程只能发起这两种来源；mobile 属于 Phase 2 的 HTTP 入口。 */
export type RendererPrintSource = 'desktop' | 'history';

export interface PrintOptions {
  source: RendererPrintSource;
  force: boolean;
}

export interface LabelPreview {
  result: PreviewResult;
  /** 与实际打印相同的标签 HTML；识别不了时为 null。 */
  html: string | null;
  /** 这次用的模板（规则绑定的模板或当前模板）；识别不了时为 null。 */
  templateName: string | null;
  /** 内容太长，二维码放不下被省略了。 */
  qrOmitted: boolean;
}

export type LookupImportResult =
  | { status: 'imported'; table: LookupTableInfo }
  | { status: 'canceled' }
  | { status: 'invalid'; issue: string };

export interface AppInfo {
  productName: string;
  brandOwner: string;
  version: string;
  dataPath: string;
  /** 日志目录：每天一个 labelflash-<日期>.log。 */
  logsDir: string;
}

export interface LabelFlashApi {
  preview(raw: string): Promise<LabelPreview>;
  /** 模板编辑时的实时预览：用未保存的草稿模板渲染。 */
  previewTemplate(raw: string, template: LabelTemplate): Promise<LabelPreview>;
  print(raw: string, printerName: string, options: PrintOptions): Promise<PrintResult>;
  printTest(printerName: string): Promise<PrintResult>;
  listPrinters(): Promise<PrinterInfo[]>;
  printerStatus(printerName: string): Promise<PrinterReadiness | null>;
  /** 驱动默认纸张是否为 60×40（每次调用都重新读取驱动设置）。 */
  checkDriverPaper(printerName: string): Promise<PaperCheck>;
  /** 打开驱动的「打印首选项」窗口；窗口关闭后才完成。 */
  openPrinterPreferences(printerName: string): Promise<void>;
  listJobs(query: JobQuery): Promise<JobPage>;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  listTemplates(): Promise<LabelTemplate[]>;
  duplicateTemplate(sourceId: string): Promise<LabelTemplate>;
  saveTemplate(template: LabelTemplate): Promise<LabelTemplate>;
  /** 删除后若它正在使用，自动切回标准模板；返回最新设置。 */
  deleteTemplate(id: string): Promise<AppSettings>;
  listRules(): Promise<RuleListing>;
  createRule(kind: RuleKind): Promise<RuleMutation>;
  duplicateRule(id: string): Promise<RuleMutation>;
  saveRule(rule: ScanRule): Promise<RuleMutation>;
  deleteRule(id: string): Promise<RuleListing>;
  /** 保存顺序、启用和模板绑定。 */
  saveRuleSettings(settings: RuleSetting[]): Promise<RuleListing>;
  /** draft 为正在编辑、还没保存的规则；不传则按本机当前规则识别。 */
  testRule(raw: string, draft?: ScanRule): Promise<RuleTestResult>;
  /** 主进程弹出保存对话框。 */
  exportRules(ids: string[]): Promise<RuleExportResult>;
  /** 主进程弹出打开对话框。 */
  importRules(): Promise<RuleImportResult>;
  listLookupTables(): Promise<LookupTableInfo[]>;
  /** 主进程弹出选择文件的对话框；replaceId 不为 null 时替换那张表的内容。 */
  importLookupTable(replaceId: string | null): Promise<LookupImportResult>;
  deleteLookupTable(id: string): Promise<void>;
  /** 只返回密钥名称；内容写进去以后界面上再也看不到。 */
  listSecrets(): Promise<string[]>;
  /** 新增或替换；名称或内容不合法、系统加密不可用时返回原因。 */
  setSecret(name: string, value: string): Promise<{ ok: true } | { ok: false; issue: string }>;
  deleteSecret(name: string): Promise<void>;
  /** 最近的通知发送记录（新的在前）。接口本身在设置的 webhooks 里增删改。 */
  listWebhookDeliveries(): Promise<Delivery[]>;
  /** 失败或正在等待重试的通知立即重发；已送达的返回 false。 */
  retryWebhookDelivery(id: number): Promise<boolean>;
  /** 给这个接口发一条测试事件；接口不存在时返回 false。 */
  sendTestWebhook(endpointId: string): Promise<boolean>;
  getAppInfo(): Promise<AppInfo>;
  openLogFolder(): Promise<void>;
  /** 用系统浏览器打开出品方店铺（地址是主进程里的常量，页面不能指定网址）。 */
  openShop(): Promise<void>;
  getUpdateStatus(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<void>;
  /** 仅在新版本已下载（ready）时有效：重启并安装。 */
  installUpdate(): Promise<void>;
  onUpdateStatus(listener: (status: UpdateStatus) => void): () => void;
  /** 当前音色、语速下这句播报的 mp3；离线且没有缓存时为 null。 */
  getVoiceClip(cue: VoiceCue): Promise<Uint8Array | null>;
}

export interface WindowControlsApi {
  /** 窗口按钮由系统（macOS 红绿灯）还是界面来画。 */
  readonly chrome: WindowChrome;
  minimize(): void;
  toggleMaximize(): void;
  /** 隐藏到托盘，不退出。 */
  close(): void;
  onMaximizedChange(listener: (isMaximized: boolean) => void): () => void;
  /** macOS 全屏时系统隐藏红绿灯，标题栏收回为它让出的位置。 */
  onFullScreenChange(listener: (isFullScreen: boolean) => void): () => void;
}
