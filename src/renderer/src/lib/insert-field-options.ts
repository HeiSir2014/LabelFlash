import type { ScanResult } from '../../../core/scan/scan-result';
import { NOTE_VARIABLES } from '../../../core/templates/note-text';

/** 下拉框的一个选项。 */
export interface SelectOption {
  value: string;
  label: string;
}

/** 下拉框的第一项是提示，不是字段：选了字段之后马上回到它，下次还能再插。 */
export const INSERT_FIELD_PLACEHOLDER = '';

/** 选项里引用的值最多这么多个字：下拉框一行放得下，后面用「…」。 */
const SAMPLE_VALUE_LENGTH = 16;

/** 值写进选项：换行显示成 ⏎（和扫码框一样），太长的截断。 */
function sampleText(value: string): string {
  const characters = [...value.replace(/\r?\n/g, '⏎')];
  return characters.length <= SAMPLE_VALUE_LENGTH
    ? characters.join('')
    : `${characters.slice(0, SAMPLE_VALUE_LENGTH - 1).join('')}…`;
}

/** 有样例时一个名字的写法：「编码 — CL5640-TK」，这段内容里没有（或是空的）写「货架号（这段内容里没有）」。 */
function labelWithSample(name: string, value: string | undefined): string {
  return value === undefined || value === '' ? `${name}（这段内容里没有）` : `${name} — ${sampleText(value)}`;
}

/**
 * 「插入字段」下拉框的选项：扫码识别出的字段在前，固定的内置变量（{完整内容}……）在后。
 * 有「预览内容」识别出的结果（sample）时，每个字段后面写出这一段里的值，没有的写明「这段内容里没有」——
 * 选之前就知道印出来是什么；这段内容里识别出、规则里没列的字段也列上。
 * fieldNames 可能带重复（同一个字段名来自不同规则，或者和识别出的撞了），这里去重；
 * 固定变量里和字段名撞车的那个也不重复列出。
 */
export function insertFieldOptions(
  fieldNames: readonly string[],
  sample: ScanResult | null = null,
): readonly SelectOption[] {
  const uniqueNames = [...new Set([...fieldNames, ...(sample?.fields.map((field) => field.name) ?? [])])];
  const fixed = NOTE_VARIABLES.filter((variable) => !uniqueNames.includes(variable.slice(1, -1)));
  const fixedSample: Readonly<Record<string, string | undefined>> = {
    完整内容: sample?.raw,
    规则: sample?.ruleName,
  };
  return [
    { value: INSERT_FIELD_PLACEHOLDER, label: '插入字段…' },
    ...uniqueNames.map((name) => ({
      value: `{${name}}`,
      label: sample === null ? name : labelWithSample(name, sample.fields.find((field) => field.name === name)?.value),
    })),
    ...fixed.map((variable) => {
      const name = variable.slice(1, -1);
      const value = fixedSample[name];
      return { value: variable, label: sample === null || value === undefined ? name : labelWithSample(name, value) };
    }),
  ];
}
