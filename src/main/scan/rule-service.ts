import type { EnrichResult } from '../../core/scan/enrich';
import type { EnrichStep } from '../../core/scan/enrich-model';
import { normalizeRaw } from '../../core/scan/normalize-raw';
import { type RegexRunner, recognize } from '../../core/scan/recognize';
import { type RuleCatalog, RuleError } from '../../core/scan/rule-catalog';
import { hasHttpStep, httpHostsOf, parseRuleFile, serializeRules } from '../../core/scan/rule-file';
import type { RuleKind, ScanRule } from '../../core/scan/rule-model';
import { mergeRuleSettings, type RuleSetting } from '../../core/scan/rule-settings';
import { isRuleIssue, sanitizeRule } from '../../core/scan/sanitize-rule';
import type { ScanResult } from '../../core/scan/scan-result';
import type { Clock } from '../../core/types';
import type { RuleImportResult, RuleListing, RuleMutation, RuleTestResult } from '../../shared/rule-api';
import type { AppSettings } from '../../shared/settings';
import { activeRules } from '../print-template';

export interface RuleSettingsStore {
  readonly current: AppSettings;
  update(patch: Partial<AppSettings>): AppSettings;
}

export interface RuleServiceDeps {
  catalog: RuleCatalog;
  settings: RuleSettingsStore;
  runRegex: RegexRunner;
  enrich: (scan: ScanResult, steps: readonly EnrichStep[]) => Promise<EnrichResult>;
  clock: Clock;
}

/** 试一试时正在编辑的草稿规则用这个 id（不会保存）。 */
const DRAFT_RULE_ID = 'custom:draft';

/** 「识别规则」页背后的业务：增删改、试一试、导入导出。IPC 层只做参数校验和文件对话框。 */
export class RuleService {
  constructor(private readonly deps: RuleServiceDeps) {}

  list(): RuleListing {
    const rules = this.deps.catalog.list();
    return { rules, settings: this.mergedSettings() };
  }

  create(kind: RuleKind): RuleMutation {
    return this.mutate(() => this.deps.catalog.create(kind));
  }

  duplicate(id: string): RuleMutation {
    return this.mutate(() => this.deps.catalog.duplicate(id));
  }

  save(id: string, value: unknown): RuleMutation {
    return this.mutate(() => this.deps.catalog.save(id, value));
  }

  remove(id: string): RuleListing {
    this.deps.catalog.remove(id);
    this.saveSettings(this.mergedSettings());
    return this.list();
  }

  /** 保存顺序、启用和模板绑定（主进程重新校验并和现有规则对齐）。 */
  saveSettings(settings: readonly RuleSetting[]): RuleListing {
    const ids = this.deps.catalog.list().map((rule) => rule.id);
    this.deps.settings.update({ ruleSettings: mergeRuleSettings(settings, ids) });
    return this.list();
  }

  /**
   * 试一试：draft 不为 undefined 时只用这条（还没保存的）规则识别并执行它的加工步骤；
   * 否则按本机当前的规则顺序识别，与真正扫码完全一致。
   */
  async test(raw: string, draft: unknown): Promise<RuleTestResult> {
    if (normalizeRaw(raw) === null) {
      return { status: 'invalid', reason: 'INVALID_CONTENT' };
    }
    let rules = activeRules(this.deps.catalog, this.deps.settings.current);
    if (draft !== undefined) {
      const rule = sanitizeRule(draft, DRAFT_RULE_ID);
      if (isRuleIssue(rule)) {
        return { status: 'invalid-rule', issue: rule.issue };
      }
      rules = [rule];
    }
    const recognized = recognize(raw, rules, this.deps.runRegex);
    if (!recognized) {
      return { status: 'invalid', reason: 'NO_MATCHING_RULE' };
    }
    const steps = rules.find((rule) => rule.id === recognized.ruleId)?.steps ?? [];
    return { status: 'ok', recognized, enriched: await this.deps.enrich(recognized, steps) };
  }

  /** 导入：新规则排在「原样打印」之前；含 HTTP 查询的默认停用，由用户确认域名后手动启用。 */
  importText(text: string): RuleImportResult {
    const parsed = parseRuleFile(text);
    if (!parsed.ok) {
      return { status: 'invalid', issue: parsed.issue };
    }
    const outcome = this.deps.catalog.importRules(parsed.rules);
    const disabled = new Set(outcome.imported.filter(hasHttpStep).map((rule) => rule.id));
    const settings = this.mergedSettings().map((setting) =>
      disabled.has(setting.id) ? { ...setting, enabled: false } : setting,
    );
    this.saveSettings(settings);
    return {
      status: 'imported',
      imported: outcome.imported.length,
      skipped: outcome.skipped,
      httpHosts: httpHostsOf(outcome.imported),
    };
  }

  /** 导出指定的规则（按列表顺序）；返回文件内容和实际导出的条数。 */
  exportText(ids: readonly string[]): { text: string; count: number } {
    const wanted = new Set(ids);
    const rules = this.deps.catalog.list().filter((rule) => wanted.has(rule.id));
    return { text: serializeRules(rules, this.deps.clock.now()), count: rules.length };
  }

  private mergedSettings(): RuleSetting[] {
    const ids = this.deps.catalog.list().map((rule) => rule.id);
    return mergeRuleSettings(this.deps.settings.current.ruleSettings, ids);
  }

  private mutate(action: () => ScanRule): RuleMutation {
    try {
      const rule = action();
      this.saveSettings(this.mergedSettings());
      return { ok: true, rule };
    } catch (error) {
      if (error instanceof RuleError) {
        return { ok: false, issue: error.message };
      }
      throw error;
    }
  }
}
