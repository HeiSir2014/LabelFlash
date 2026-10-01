import type { TemplateFields } from '../api/template-fields';
import { type FieldSource, SERIAL_FIELD, sourceOf } from './batch-model';

/** 比较列名时忽略空白、全角半角和大小写：Excel 表头常有「编 码」「ＳＫＵ」这样的写法。 */
function normalizeName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

/** 按列名对上模板变量：先找完全相同的列，再找忽略空白、全角半角、大小写后相同的；对不上的不填。 */
export function autoMapping(variables: readonly string[], columns: readonly string[]): Record<string, FieldSource> {
  const entries = variables.map((variable): [string, FieldSource] => {
    const column =
      columns.find((name) => name === variable) ??
      columns.find((name) => normalizeName(name) === normalizeName(variable));
    return [variable, column === undefined ? { kind: 'none' } : { kind: 'column', column }];
  });
  // fromEntries 按「定义自己的属性」写入：变量名是 __proto__ 时也不会改到原型。
  return Object.fromEntries(entries);
}

/** 要对列的模板变量：模板用到的字段，不含序号（序号单独设置）。 */
export function mappableVariables(fields: TemplateFields): string[] {
  return fields.names.filter((name) => name !== SERIAL_FIELD);
}

/** 模板用到了 {序号}。 */
export function usesSerial(fields: TemplateFields): boolean {
  return fields.names.includes(SERIAL_FIELD);
}

/** 没对上的变量（不填，或对的列已经不在表里）：界面标红。固定值算对上了，空的固定值就是有意不印。 */
export function unmappedVariables(
  mapping: Readonly<Record<string, FieldSource>>,
  variables: readonly string[],
  columns: readonly string[],
): string[] {
  return variables.filter((variable) => {
    const source = sourceOf(mapping, variable);
    return source.kind === 'none' || (source.kind === 'column' && !columns.includes(source.column));
  });
}
