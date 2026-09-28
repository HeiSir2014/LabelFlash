import {
  FIELD_KEYS,
  type FieldConfig,
  type FieldKey,
  type LabelTemplate,
  maxQrSizeMm,
  NOTE_PLACEMENTS,
  type NoteConfig,
  QR_ERROR_LEVELS,
  QR_LAYOUTS,
  TEMPLATE_LIMITS,
  TEXT_ALIGNS,
  type TextStyle,
} from './template-model';

type Loose = Record<string, unknown>;

/**
 * 把不可信的输入（IPC、数据库）收敛成合法模板：缺失或类型错误的字段取 fallback，数值夹到允许范围。
 * id 永远取调用方给定的值，不信任输入里的 id。
 */
export function sanitizeTemplate(value: unknown, id: string, fallback: LabelTemplate): LabelTemplate {
  const input = asLoose(value);
  const qrInput = asLoose(input['qr']);
  const fieldsInput = asLoose(input['fields']);
  const { paddingMm, qrSizeMm, nameLength } = TEMPLATE_LIMITS;
  const padding = clamp(input['paddingMm'], paddingMm.min, paddingMm.max, fallback.paddingMm);
  const fields = {} as Record<FieldKey, FieldConfig>;
  for (const key of FIELD_KEYS) {
    fields[key] = sanitizeField(fieldsInput[key], fallback.fields[key]);
  }
  return {
    id,
    // 名称只用于列表显示：全空白等于没填，保留原名。
    name: sanitizeText(input['name'], nameLength, fallback.name).trim() || fallback.name,
    paddingMm: padding,
    layout: pick(input['layout'], QR_LAYOUTS, fallback.layout),
    sideAlign: pick(input['sideAlign'], TEXT_ALIGNS, fallback.sideAlign),
    bottomAlign: pick(input['bottomAlign'], TEXT_ALIGNS, fallback.bottomAlign),
    qr: {
      visible: bool(qrInput['visible'], fallback.qr.visible),
      sizeMm: clamp(qrInput['sizeMm'], qrSizeMm.min, maxQrSizeMm(padding), fallback.qr.sizeMm),
      errorCorrection: pick(qrInput['errorCorrection'], QR_ERROR_LEVELS, fallback.qr.errorCorrection),
    },
    fields,
    note: sanitizeNote(input['note'], fallback.note),
  };
}

function sanitizeStyle(input: Loose, fallback: TextStyle): TextStyle {
  const { fontSizeMm } = TEMPLATE_LIMITS;
  return {
    fontSizeMm: clamp(input['fontSizeMm'], fontSizeMm.min, fontSizeMm.max, fallback.fontSizeMm),
    bold: bool(input['bold'], fallback.bold),
  };
}

function sanitizeField(value: unknown, fallback: FieldConfig): FieldConfig {
  const input = asLoose(value);
  return {
    ...sanitizeStyle(input, fallback),
    visible: bool(input['visible'], fallback.visible),
    prefix: sanitizeText(input['prefix'], TEMPLATE_LIMITS.prefixLength, fallback.prefix),
  };
}

function sanitizeNote(value: unknown, fallback: NoteConfig): NoteConfig {
  const input = asLoose(value);
  return {
    ...sanitizeStyle(input, fallback),
    visible: bool(input['visible'], fallback.visible),
    text: sanitizeText(input['text'], TEMPLATE_LIMITS.noteLength, fallback.text),
    placement: pick(input['placement'], NOTE_PLACEMENTS, fallback.placement),
  };
}

function asLoose(value: unknown): Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Loose) : {};
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, number));
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: 专门用来去掉控制字符（保留换行）
const CONTROL_CHARACTERS = /[\u0000-\u0009\u000b-\u001f\u007f]/g;

/** 去掉控制字符（保留换行，备注允许多行）并截断长度。 */
function sanitizeText(value: unknown, maxLength: number, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  return value.replace(CONTROL_CHARACTERS, '').slice(0, maxLength);
}
