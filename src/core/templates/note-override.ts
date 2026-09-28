import type { LabelTemplate } from './template-model';

/**
 * 主界面「备注」下拉框的选择：沿用模板备注、不打印备注，或用一条常用备注替换模板的备注文字
 * （位置、字号、对齐仍取模板设置）。
 */
export type NoteOverride = { kind: 'template' } | { kind: 'none' } | { kind: 'text'; text: string };

export const DEFAULT_NOTE_OVERRIDE: NoteOverride = { kind: 'template' };

export function applyNoteOverride(template: LabelTemplate, override: NoteOverride): LabelTemplate {
  switch (override.kind) {
    case 'template':
      return template;
    case 'none':
      return { ...template, note: { ...template.note, visible: false } };
    case 'text':
      return { ...template, note: { ...template.note, visible: true, text: override.text } };
  }
}
