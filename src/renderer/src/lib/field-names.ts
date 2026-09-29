import type { EnrichStep } from '../../../core/scan/enrich-model';
import { namedGroups, type ScanRule } from '../../../core/scan/rule-model';
import type { ScanResult } from '../../../core/scan/scan-result';

/** 模板页里字段名候选 `<datalist>` 的 id：字段名输入框用 `list` 指向它。 */
export const FIELD_NAME_LIST_ID = 'field-name-suggestions';

/** 一条规则能产出的字段名：识别出的字段 + 加工步骤产出的字段，按出现顺序。 */
export function ruleFieldNames(rule: ScanRule): string[] {
  return [...recognisedNames(rule), ...rule.steps.flatMap(stepOutputs)];
}

/** 字段名候选：先列这次识别出的字段，再按规则顺序列其余字段，去重。 */
export function fieldNameSuggestions(rules: readonly ScanRule[], scan: ScanResult | null): string[] {
  const names = [...(scan?.fields.map((field) => field.name) ?? []), ...rules.flatMap(ruleFieldNames)];
  return [...new Set(names)];
}

function recognisedNames(rule: ScanRule): string[] {
  switch (rule.kind) {
    case 'delimited':
      return rule.fields;
    case 'keyValue':
      return rule.fields.map((field) => field.name);
    case 'whole':
      return [rule.field];
    case 'regex':
      try {
        return namedGroups(rule.pattern, rule.flags);
      } catch {
        // 编辑中的正则可能暂时写不对：不给候选即可。
        return [];
      }
  }
}

function stepOutputs(step: EnrichStep): string[] {
  switch (step.kind) {
    case 'template':
    case 'regexReplace':
    case 'imageText':
      return [step.output];
    case 'lookup':
    case 'http':
      return step.outputs.map((output) => output.field);
  }
}
