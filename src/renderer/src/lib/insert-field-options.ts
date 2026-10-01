import { NOTE_VARIABLES } from '../../../core/templates/note-text';

/** 下拉框的一个选项。 */
export interface SelectOption {
  value: string;
  label: string;
}

/** 下拉框的第一项是提示，不是字段：选了字段之后马上回到它，下次还能再插。 */
export const INSERT_FIELD_PLACEHOLDER = '';

/**
 * 「插入字段」下拉框的选项：扫码识别出的字段在前，固定的内置变量（{完整内容}……）在后；
 * fieldNames 可能带重复（同一个字段名来自不同规则，或者这次预览识别出的字段和规则里的撞了），
 * 这里去重，下拉框不出现两行一样的；固定变量里和字段名撞车的那个也不重复列出。
 */
export function insertFieldOptions(fieldNames: readonly string[]): readonly SelectOption[] {
  const uniqueNames = [...new Set(fieldNames)];
  const fixed = NOTE_VARIABLES.filter((variable) => !uniqueNames.includes(variable.slice(1, -1)));
  return [
    { value: INSERT_FIELD_PLACEHOLDER, label: '插入字段…' },
    ...uniqueNames.map((name) => ({ value: `{${name}}`, label: name })),
    ...fixed.map((variable) => ({ value: variable, label: variable.slice(1, -1) })),
  ];
}
