import type { NoteOverride } from '../../../core/templates/note-override';

export interface NoteOption {
  value: string;
  label: string;
}

export const NOTE_OPTION_VALUES = {
  template: 'template',
  none: 'none',
  /** 当前使用的备注已从常用备注里删除，但仍保留生效。 */
  current: 'current',
  manage: 'manage',
} as const;

const PRESET_PREFIX = 'preset:';
const MAX_LABEL_LENGTH = 16;

/** 下拉框里的显示文字：只取第一行，过长截断。 */
export function summarizeNote(text: string): string {
  const firstLine = text.split('\n')[0] ?? '';
  const hasMore = text.includes('\n') || [...firstLine].length > MAX_LABEL_LENGTH;
  return hasMore ? `${[...firstLine].slice(0, MAX_LABEL_LENGTH).join('')}…` : firstLine;
}

export function buildNoteOptions(
  presets: readonly string[],
  override: NoteOverride,
): { options: NoteOption[]; selected: string } {
  const options: NoteOption[] = [
    { value: NOTE_OPTION_VALUES.template, label: '模板备注' },
    { value: NOTE_OPTION_VALUES.none, label: '不打印备注' },
    ...presets.map((text, index) => ({ value: `${PRESET_PREFIX}${index}`, label: summarizeNote(text) })),
  ];
  let selected: string = override.kind === 'none' ? NOTE_OPTION_VALUES.none : NOTE_OPTION_VALUES.template;
  if (override.kind === 'text') {
    const index = presets.indexOf(override.text);
    if (index >= 0) {
      selected = `${PRESET_PREFIX}${index}`;
    } else {
      options.push({ value: NOTE_OPTION_VALUES.current, label: `${summarizeNote(override.text)}（已不在常用备注）` });
      selected = NOTE_OPTION_VALUES.current;
    }
  }
  options.push({ value: NOTE_OPTION_VALUES.manage, label: '管理常用备注…' });
  return { options, selected };
}

/** 把下拉框的值还原成设置；`manage` 表示打开设置页；无法识别返回 null。 */
export function resolveNoteSelection(value: string, presets: readonly string[]): NoteOverride | 'manage' | null {
  if (value === NOTE_OPTION_VALUES.manage) {
    return 'manage';
  }
  if (value === NOTE_OPTION_VALUES.template) {
    return { kind: 'template' };
  }
  if (value === NOTE_OPTION_VALUES.none) {
    return { kind: 'none' };
  }
  if (value.startsWith(PRESET_PREFIX)) {
    const text = presets[Number(value.slice(PRESET_PREFIX.length))];
    return text === undefined ? null : { kind: 'text', text };
  }
  return null;
}
