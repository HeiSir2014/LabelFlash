import { DEFAULT_PAPER } from '../../shared/label-paper';
import { sanitizePaper } from '../../shared/paper-sizes';
import { isValidFieldName } from '../scan/rule-model';
import {
  type BottomLine,
  FIELD_ARRANGEMENTS,
  FIELDS_MODES,
  type FieldSlot,
  type FieldsArea,
  type LabelTemplate,
  maxQrSizeMm,
  NOTE_PLACEMENTS,
  type NoteConfig,
  QR_ERROR_LEVELS,
  QR_LAYOUTS,
  type QrContent,
  TEMPLATE_LIMITS,
  TEXT_ALIGNS,
  type TextStyle,
} from './template-model';

type Loose = Record<string, unknown>;

/** 模板原来一行指定字段都没有时，新行的默认样式。 */
const DEFAULT_SLOT_STYLE: TextStyle = { fontSizeMm: 3.2, bold: true };

/**
 * 把不可信的输入（IPC、数据库）收敛成合法模板：缺失或类型错误的字段取 fallback，数值夹到允许范围。
 * id 永远取调用方给定的值，不信任输入里的 id。
 */
export function sanitizeTemplate(value: unknown, id: string, fallback: LabelTemplate): LabelTemplate {
  const input = asLoose(value);
  const qrInput = asLoose(input['qr']);
  const { paddingMm, qrSizeMm, nameLength } = TEMPLATE_LIMITS;
  // 旧模板（1.0.x）没有纸张字段：按 60×40 读出。
  const paper = sanitizePaper(input['paper'], fallback.paper ?? DEFAULT_PAPER);
  const padding = clamp(input['paddingMm'], paddingMm.min, paddingMm.max, fallback.paddingMm);
  return {
    id,
    // 名称只用于列表显示：全空白等于没填，保留原名。
    name: sanitizeText(input['name'], nameLength, fallback.name).trim() || fallback.name,
    paper,
    printer: sanitizePrinterName(input['printer']),
    paddingMm: padding,
    layout: pick(input['layout'], QR_LAYOUTS, fallback.layout),
    sideAlign: pick(input['sideAlign'], TEXT_ALIGNS, fallback.sideAlign),
    bottomAlign: pick(input['bottomAlign'], TEXT_ALIGNS, fallback.bottomAlign),
    qr: {
      visible: bool(qrInput['visible'], fallback.qr.visible),
      sizeMm: clamp(qrInput['sizeMm'], qrSizeMm.min, maxQrSizeMm(paper, padding), fallback.qr.sizeMm),
      errorCorrection: pick(qrInput['errorCorrection'], QR_ERROR_LEVELS, fallback.qr.errorCorrection),
      content: sanitizeQrContent(qrInput['content'], fallback.qr.content),
    },
    fieldsArea: sanitizeFieldsArea(input['fieldsArea'], fallback.fieldsArea),
    bottom: sanitizeBottom(input['bottom'], fallback.bottom),
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

function sanitizeFieldsArea(value: unknown, fallback: FieldsArea): FieldsArea {
  const input = asLoose(value);
  const allInput = asLoose(input['all']);
  return {
    mode: pick(input['mode'], FIELDS_MODES, fallback.mode),
    arrangement: pick(input['arrangement'], FIELD_ARRANGEMENTS, fallback.arrangement),
    all: {
      ...sanitizeStyle(allInput, fallback.all),
      showNames: bool(allInput['showNames'], fallback.all.showNames),
      // 分隔符不能换行：前缀和值分行由「垂直排列」负责。
      separator: sanitizeText(
        typeof allInput['separator'] === 'string' ? allInput['separator'].replace(/\n/g, '') : undefined,
        TEMPLATE_LIMITS.separatorLength,
        fallback.all.separator,
      ),
    },
    slots: Array.isArray(input['slots']) ? sanitizeSlots(input['slots'], fallback.slots) : fallback.slots,
  };
}

/** 字段名不合法或重复的行直接丢掉（没有合理的默认字段名可以补）；样式缺失时取第一行默认样式。 */
function sanitizeSlots(values: readonly unknown[], fallback: readonly FieldSlot[]): FieldSlot[] {
  const styleFallback = fallback[0] ?? DEFAULT_SLOT_STYLE;
  const seen = new Set<string>();
  const slots: FieldSlot[] = [];
  for (const value of values) {
    const input = asLoose(value);
    const field = input['field'];
    if (typeof field !== 'string' || !isValidFieldName(field) || seen.has(field)) {
      continue;
    }
    seen.add(field);
    slots.push({
      ...sanitizeStyle(input, styleFallback),
      field,
      prefix: sanitizeText(input['prefix'], TEMPLATE_LIMITS.prefixLength, ''),
    });
    if (slots.length === TEMPLATE_LIMITS.slots) {
      break;
    }
  }
  return slots;
}

function sanitizeBottom(value: unknown, fallback: BottomLine): BottomLine {
  const input = asLoose(value);
  return { ...sanitizeStyle(input, fallback), visible: bool(input['visible'], fallback.visible) };
}

function sanitizeQrContent(value: unknown, fallback: QrContent): QrContent {
  const input = asLoose(value);
  switch (input['kind']) {
    case 'raw':
      return { kind: 'raw' };
    case 'field': {
      const field = input['field'];
      return typeof field === 'string' && isValidFieldName(field) ? { kind: 'field', field } : fallback;
    }
    case 'text':
      return { kind: 'text', text: sanitizeText(input['text'], TEMPLATE_LIMITS.noteLength, '') };
    default:
      return fallback;
  }
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

/** 打印机名只保存、只比较，交给系统命令之前主进程会先核对它在系统里存在；空白或超长当作不指定。 */
function sanitizePrinterName(value: unknown): string | null {
  const { printerNameLength } = TEMPLATE_LIMITS;
  return typeof value === 'string' && value.trim() !== '' && value.length <= printerNameLength ? value : null;
}
