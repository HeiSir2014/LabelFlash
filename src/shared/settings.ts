import { MAX_DEDUP_WINDOW_MS } from '../core/dedup-guard';
import { DEFAULT_TEMPLATE_ID } from '../core/templates/builtin-templates';
import { DEFAULT_NOTE_OVERRIDE, type NoteOverride } from '../core/templates/note-override';
import { TEMPLATE_ID_PATTERN, TEMPLATE_LIMITS } from '../core/templates/template-model';

export interface AppSettings {
  selectedPrinter: string | null;
  activeTemplateId: string;
  /** 主界面「备注」下拉框的当前选择。 */
  noteOverride: NoteOverride;
  /** 常用备注，供下拉框快速切换。 */
  notePresets: string[];
  autoPrint: boolean;
  dedupWindowMinutes: number;
  historyLimit: number;
  launchAtLogin: boolean;
}

export const MS_PER_MINUTE = 60_000;
export const MAX_DEDUP_WINDOW_MINUTES = MAX_DEDUP_WINDOW_MS / MS_PER_MINUTE;
export const HISTORY_LIMIT_RANGE = { min: 1_000, max: 1_000_000 } as const;
const MAX_PRINTER_NAME_LENGTH = 256;
export const MAX_NOTE_PRESETS = 20;

export const DEFAULT_SETTINGS: AppSettings = {
  selectedPrinter: null,
  activeTemplateId: DEFAULT_TEMPLATE_ID,
  noteOverride: DEFAULT_NOTE_OVERRIDE,
  notePresets: [],
  autoPrint: true,
  dedupWindowMinutes: 10,
  historyLimit: 100_000,
  launchAtLogin: false,
};

export function sanitizeSettings(value: unknown): AppSettings {
  const input = isRecord(value) ? value : {};
  return {
    selectedPrinter: sanitizePrinterName(input['selectedPrinter']),
    activeTemplateId: sanitizeTemplateId(input['activeTemplateId']),
    noteOverride: sanitizeNoteOverride(input['noteOverride']),
    notePresets: sanitizeNotePresets(input['notePresets']),
    autoPrint: sanitizeBoolean(input['autoPrint'], DEFAULT_SETTINGS.autoPrint),
    dedupWindowMinutes: sanitizeInteger(
      input['dedupWindowMinutes'],
      0,
      MAX_DEDUP_WINDOW_MINUTES,
      DEFAULT_SETTINGS.dedupWindowMinutes,
    ),
    historyLimit: sanitizeInteger(
      input['historyLimit'],
      HISTORY_LIMIT_RANGE.min,
      HISTORY_LIMIT_RANGE.max,
      DEFAULT_SETTINGS.historyLimit,
    ),
    launchAtLogin: sanitizeBoolean(input['launchAtLogin'], DEFAULT_SETTINGS.launchAtLogin),
  };
}

export function minutesToMs(minutes: number): number {
  return minutes * MS_PER_MINUTE;
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
