import type { RuleRepository } from '../scan/rule-catalog';
import type { ScanRule } from '../scan/rule-model';
import type { TemplateRepository } from '../templates/template-catalog';
import type { LabelTemplate } from '../templates/template-model';

/** 测试替身：自定义规则存在内存里，按保存顺序列出。 */
export class InMemoryRuleRepository implements RuleRepository {
  readonly rules = new Map<string, ScanRule>();

  listCustom(): ScanRule[] {
    return [...this.rules.values()];
  }

  save(rule: ScanRule): void {
    this.rules.set(rule.id, rule);
  }

  remove(id: string): void {
    this.rules.delete(id);
  }
}

/** 测试替身：自定义模板存在内存里，按保存顺序列出。 */
export class InMemoryTemplateRepository implements TemplateRepository {
  readonly saved = new Map<string, LabelTemplate>();

  listCustom(): LabelTemplate[] {
    return [...this.saved.values()];
  }

  save(template: LabelTemplate): void {
    this.saved.set(template.id, template);
  }

  remove(id: string): void {
    this.saved.delete(id);
  }
}
