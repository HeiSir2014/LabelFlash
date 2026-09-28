import { describe, expect, test } from 'bun:test';
import { BUILT_IN_RULES } from './builtin-rules';
import { RuleCatalog, RuleError, type RuleRepository } from './rule-catalog';
import { RULE_KINDS, RULE_LIMITS, type ScanRule } from './rule-model';
import { isRuleIssue, sanitizeRule } from './sanitize-rule';

class InMemoryRuleRepository implements RuleRepository {
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

function setup() {
  const repository = new InMemoryRuleRepository();
  let next = 0;
  const catalog = new RuleCatalog(repository, () => `r${++next}`);
  return { repository, catalog };
}

const UNDERSCORE = {
  kind: 'delimited',
  name: '下划线',
  delimiter: '_',
  fields: ['款号', '颜色', '尺码'],
  overflowIndex: 0,
};

function codeOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof RuleError) {
      return error.code;
    }
    throw error;
  }
  throw new Error('expected a RuleError');
}

describe('RuleCatalog', () => {
  test('lists the built-in rules first, then the custom ones', () => {
    const { catalog } = setup();
    const created = catalog.create('delimited');
    expect(catalog.list().map((rule) => rule.id)).toEqual([...BUILT_IN_RULES.map((rule) => rule.id), created.id]);
    expect(catalog.get(created.id)).toEqual(created);
  });

  test('creates a valid starting rule of every kind', () => {
    const { catalog } = setup();
    for (const kind of RULE_KINDS) {
      const rule = catalog.create(kind);
      expect(rule.id.startsWith('custom:')).toBe(true);
      expect(isRuleIssue(sanitizeRule(rule, rule.id))).toBe(false);
    }
  });

  test('duplicates a built-in rule into an editable copy', () => {
    const { catalog } = setup();
    const copy = catalog.duplicate('builtin:dash-three');
    expect(copy.id).toBe('custom:r1');
    expect(copy.name).toBe('横杠三段（编码-颜色-尺码） 副本');
    expect(copy.kind).toBe('delimited');
  });

  test('saves valid edits and rejects invalid ones with the reason', () => {
    const { catalog } = setup();
    const { id } = catalog.create('delimited');
    expect(catalog.save(id, UNDERSCORE)).toEqual({ ...UNDERSCORE, id } as ScanRule);
    try {
      catalog.save(id, { ...UNDERSCORE, fields: ['款号'] });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(RuleError);
      expect((error as RuleError).code).toBe('INVALID');
      expect((error as RuleError).message).toContain('2');
    }
  });

  test('keeps built-in rules read-only', () => {
    const { catalog } = setup();
    expect(codeOf(() => catalog.save('builtin:raw', UNDERSCORE))).toBe('BUILT_IN_READ_ONLY');
    expect(codeOf(() => catalog.remove('builtin:raw'))).toBe('BUILT_IN_READ_ONLY');
    expect(codeOf(() => catalog.remove('custom:missing'))).toBe('NOT_FOUND');
  });

  test('removes a custom rule', () => {
    const { catalog } = setup();
    const { id } = catalog.create('whole');
    catalog.remove(id);
    expect(catalog.get(id)).toBeNull();
  });

  test('stops at the custom rule limit', () => {
    const { catalog } = setup();
    for (let i = 0; i < RULE_LIMITS.customRules; i += 1) {
      catalog.create('whole');
    }
    expect(codeOf(() => catalog.create('whole'))).toBe('LIMIT');
    expect(codeOf(() => catalog.duplicate('builtin:raw'))).toBe('LIMIT');
  });

  test('imports valid rules as new custom rules and explains every skipped one', () => {
    const { catalog } = setup();
    const outcome = catalog.importRules([
      { ...UNDERSCORE, id: 'builtin:raw' },
      { ...UNDERSCORE, fields: ['款号'] },
      'not a rule',
    ]);
    expect(outcome.imported.map((rule) => rule.id)).toEqual(['custom:r1']);
    expect(outcome.imported[0]?.name).toBe('下划线');
    expect(outcome.skipped.map((item) => item.index)).toEqual([1, 2]);
    expect(outcome.skipped[0]?.issue).toContain('2');
  });

  test('skips imported rules beyond the custom rule limit', () => {
    const { catalog } = setup();
    const many = Array.from({ length: RULE_LIMITS.customRules + 2 }, (_, i) => ({ ...UNDERSCORE, name: `规则${i}` }));
    const outcome = catalog.importRules(many);
    expect(outcome.imported).toHaveLength(RULE_LIMITS.customRules);
    expect(outcome.skipped.map((item) => item.index)).toEqual([RULE_LIMITS.customRules, RULE_LIMITS.customRules + 1]);
    expect(outcome.skipped[0]?.issue).toContain(String(RULE_LIMITS.customRules));
  });
});
