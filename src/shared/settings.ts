import { MAX_DEDUP_WINDOW_MS } from '../core/dedup-guard';
import { sanitizeWebhooks, type WebhookEndpoint } from '../core/notify/webhook-model';
import { defaultRuleSettings, type RuleSetting, sanitizeRuleSettings } from '../core/scan/rule-settings';
import { DEFAULT_TEMPLATE_ID } from '../core/templates/builtin-templates';
import { DEFAULT_NOTE_OVERRIDE, type NoteOverride } from '../core/templates/note-override';
import { TEMPLATE_ID_PATTERN, TEMPLATE_LIMITS } from '../core/templates/template-model';
import { sanitizeRelayUrl } from './relay-url';
import { DEFAULT_VOICE_NAME, isVoiceName, VOICE_RATE_RANGE, type VoiceSettings } from './voice';

export interface AppSettings {
  selectedPrinter: string | null;
  activeTemplateId: string;
  /** 主界面「备注」下拉框的当前选择。 */
  noteOverride: NoteOverride;
  /** 常用备注，供下拉框快速切换。 */
  notePresets: string[];
  autoPrint: boolean;
  /** 防重复打印窗口（秒）：同一标签在这段时间内只打一次，主要用来吸收扫码枪连按。0 = 不拦截。 */
  dedupWindowSeconds: number;
  historyLimit: number;
  launchAtLogin: boolean;
  /** 扫码 / 打印后的语音确认播报。 */
  voice: VoiceSettings;
  /** 识别规则的顺序、启用和绑定的模板（本机设置，不随规则导出）。 */
  ruleSettings: RuleSetting[];
  /** 多行扫码：回车 / Tab 之后这么久没有新字符才算一次扫码结束（毫秒）。 */
  scanLineGapMs: number;
  /** 打印结果通知的接口（签名密钥只存名称，内容在密钥表里）。 */
  webhooks: WebhookEndpoint[];
  /**
   * 手机扫码的中转地址；null 表示用安装包自带的默认地址（官方安装包是官方中转服务，自己构建的没有默认值）。
   * 规则见 src/shared/relay-url.ts。
   */
  mobileRelayUrl: string | null;
}

export const MS_PER_SECOND = 1_000;
export const MAX_DEDUP_WINDOW_SECONDS = MAX_DEDUP_WINDOW_MS / MS_PER_SECOND;
export const HISTORY_LIMIT_RANGE = { min: 1_000, max: 1_000_000 } as const;
const MAX_PRINTER_NAME_LENGTH = 256;
export const MAX_NOTE_PRESETS = 20;
/** 扫码枪逐字输入只间隔几毫秒；80ms 足以区分「码里的换行」和「一次扫码结束」，人手按回车也感觉不到延迟。 */
export const SCAN_LINE_GAP_RANGE = { min: 20, max: 500, default: 80 } as const;

export const DEFAULT_SETTINGS: AppSettings = {
  selectedPrinter: null,
  activeTemplateId: DEFAULT_TEMPLATE_ID,
  noteOverride: DEFAULT_NOTE_OVERRIDE,
  notePresets: [],
  autoPrint: true,
  dedupWindowSeconds: 3,
  historyLimit: 100_000,
  // 默认开机自启：安装程序结束时会运行一次本程序，首次运行即注册启动项，扫码台开机就能用。
  // 只由程序按设置注册（不在安装脚本里写），自动更新重新运行安装程序时不会覆盖用户关掉的选择。
  launchAtLogin: true,
  voice: { enabled: true, name: DEFAULT_VOICE_NAME, ratePercent: 0 },
  ruleSettings: defaultRuleSettings(),
  scanLineGapMs: SCAN_LINE_GAP_RANGE.default,
  webhooks: [],
  mobileRelayUrl: null,
};

export function sanitizeSettings(value: unknown): AppSettings {
  const input = isRecord(value) ? value : {};
  return {
    selectedPrinter: sanitizePrinterName(input['selectedPrinter']),
    activeTemplateId: sanitizeTemplateId(input['activeTemplateId']),
    noteOverride: sanitizeNoteOverride(input['noteOverride']),
    notePresets: sanitizeNotePresets(input['notePresets']),
    autoPrint: sanitizeBoolean(input['autoPrint'], DEFAULT_SETTINGS.autoPrint),
    dedupWindowSeconds: sanitizeInteger(
      input['dedupWindowSeconds'],
      0,
      MAX_DEDUP_WINDOW_SECONDS,
      DEFAULT_SETTINGS.dedupWindowSeconds,
    ),
    historyLimit: sanitizeInteger(
      input['historyLimit'],
      HISTORY_LIMIT_RANGE.min,
      HISTORY_LIMIT_RANGE.max,
      DEFAULT_SETTINGS.historyLimit,
    ),
    launchAtLogin: sanitizeBoolean(input['launchAtLogin'], DEFAULT_SETTINGS.launchAtLogin),
    voice: sanitizeVoice(input['voice']),
    ruleSettings: sanitizeRuleSettings(input['ruleSettings']),
    scanLineGapMs: sanitizeInteger(
      input['scanLineGapMs'],
      SCAN_LINE_GAP_RANGE.min,
      SCAN_LINE_GAP_RANGE.max,
      DEFAULT_SETTINGS.scanLineGapMs,
    ),
    webhooks: sanitizeWebhooks(input['webhooks']),
    // 不合法的地址当作没填，回到默认地址：填错一次不该让手机扫码一直连不上。
    mobileRelayUrl: sanitizeRelayUrl(input['mobileRelayUrl']),
  };
}

function sanitizeVoice(value: unknown): VoiceSettings {
  const input = isRecord(value) ? value : {};
  const fallback = DEFAULT_SETTINGS.voice;
  const { min, max, step } = VOICE_RATE_RANGE;
  const rate = sanitizeInteger(input['ratePercent'], min, max, fallback.ratePercent);
  return {
    enabled: sanitizeBoolean(input['enabled'], fallback.enabled),
    name: isVoiceName(input['name']) ? input['name'] : fallback.name,
    // 语速按档位取整：同一档位对应同一份缓存音频。
    ratePercent: Math.round(rate / step) * step,
  };
}

export function secondsToMs(seconds: number): number {
  return seconds * MS_PER_SECOND;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizePrinterName(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PRINTER_NAME_LENGTH ? value : null;
}

function sanitizeTemplateId(value: unknown): string {
  return typeof value === 'string' && TEMPLATE_ID_PATTERN.test(value) ? value : DEFAULT_SETTINGS.activeTemplateId;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: 专门用来去掉控制字符（保留换行）
const NOTE_CONTROL_CHARACTERS = /[\u0000-\u0009\u000b-\u001f\u007f]/g;

/** 备注文本：去掉控制字符（保留换行）、首尾空白，限制长度；空文本返回 null。 */
export function sanitizeNoteText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.replace(NOTE_CONTROL_CHARACTERS, '').trim().slice(0, TEMPLATE_LIMITS.noteLength);
  return text === '' ? null : text;
}

function sanitizeNoteOverride(value: unknown): NoteOverride {
  if (!isRecord(value)) {
    return DEFAULT_NOTE_OVERRIDE;
  }
  if (value['kind'] === 'none') {
    return { kind: 'none' };
  }
  if (value['kind'] === 'text') {
    const text = sanitizeNoteText(value['text']);
    return text === null ? DEFAULT_NOTE_OVERRIDE : { kind: 'text', text };
  }
  return DEFAULT_NOTE_OVERRIDE;
}

function sanitizeNotePresets(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const presets = value.map(sanitizeNoteText).filter((text): text is string => text !== null);
  return [...new Set(presets)].slice(0, MAX_NOTE_PRESETS);
}

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sanitizeInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}
