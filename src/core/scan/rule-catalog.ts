import { BUILT_IN_RULES } from './builtin-rules';
import { MAX_RAW_LENGTH } from './normalize-raw';
import { CUSTOM_RULE_PREFIX, isBuiltInRuleId, RULE_LIMITS, type RuleKind, type ScanRule } from './rule-model';
import { isRuleIssue, sanitizeRule } from './sanitize-rule';

/** 自定义规则的持久化（同步，与 DatabaseSync 一致）。 */
export interface RuleRepository {
  listCustom(): ScanRule[];
  save(rule: ScanRule): void;
  remove(id: string): void;
}

export type RuleErrorCode = 'BUILT_IN_READ_ONLY' | 'NOT_FOUND' | 'INVALID' | 'LIMIT';

export class RuleError extends Error {
  readonly code: RuleErrorCode;

  constructor(code: RuleErrorCode, message: string) {
    super(message);
    this.name = 'RuleError';
    this.code = code;
  }
}

export interface ImportOutcome {
  imported: ScanRule[];
  /** index 是在导入文件 rules 数组里的位置，issue 是跳过的原因。 */
  skipped: { index: number; issue: string }[];
}

type RuleDraft<K extends RuleKind> = Omit<Extract<ScanRule, { kind: K }>, 'id'>;

/** 新建规则时的初始内容：每种类型都是一条合法、可以直接在上面改的规则。 */
const STARTER_RULES: { [K in RuleKind]: RuleDraft<K> } = {
  delimited: {
    kind: 'delimited',
    name: '新规则（分隔符拆分）',
    delimiter: '_',
    fields: ['字段1', '字段2'],
    overflowIndex: 0,
    steps: [],
  },
  keyValue: {
    kind: 'keyValue',
    name: '新规则（多行键值）',
    separators: [':', '：'],
    fields: [{ name: '字段1', aliases: [] }],
    required: [],
    keepUnknown: true,
    steps: [],
  },
  whole: {
    kind: 'whole',
    name: '新规则（整段匹配）',
    field: '内容',
    charset: 'any',
    minLength: 1,
    maxLength: MAX_RAW_LENGTH,
    steps: [],
  },
  regex: { kind: 'regex', name: '新规则（正则）', pattern: '^(?<字段1>.+)$', flags: '', steps: [] },
};

const LIMIT_MESSAGE = `自定义规则最多 ${RULE_LIMITS.customRules} 条，请先删除不用的规则`;

/** 内置规则（只读，随程序发布）+ 自定义规则（存数据库）。 */
export class RuleCatalog {
  constructor(
    private readonly repository: RuleRepository,
    private readonly createId: () => string,
  ) {}

  list(): ScanRule[] {
    return [...BUILT_IN_RULES, ...this.repository.listCustom()];
  }

  get(id: string): ScanRule | null {
    return this.list().find((rule) => rule.id === id) ?? null;
  }

  create(kind: RuleKind): ScanRule {
    this.assertBelowLimit();
    const rule = { ...structuredClone(STARTER_RULES[kind]), id: this.newId() } as ScanRule;
    this.repository.save(rule);
    return rule;
  }

  duplicate(sourceId: string): ScanRule {
    const source = this.get(sourceId);
    if (!source) {
      throw new RuleError('NOT_FOUND', `Rule ${sourceId} does not exist`);
    }
    this.assertBelowLimit();
    const copy: ScanRule = {
      ...structuredClone(source),
      id: this.newId(),
      name: `${source.name} 副本`.slice(0, RULE_LIMITS.nameLength),
    };
    this.repository.save(copy);
    return copy;
  }

  save(id: string, value: unknown): ScanRule {
    this.requireCustom(id);
    const rule = sanitizeRule(value, id);
    if (isRuleIssue(rule)) {
      throw new RuleError('INVALID', rule.issue);
    }
    this.repository.save(rule);
    return rule;
  }

  remove(id: string): void {
    this.requireCustom(id);
    this.repository.remove(id);
  }

  /** 导入的规则一律作为新的自定义规则（生成新 id，不信任文件里的 id）；无效或超出数量上限的跳过并说明原因。 */
  importRules(values: readonly unknown[]): ImportOutcome {
    const outcome: ImportOutcome = { imported: [], skipped: [] };
    let room = RULE_LIMITS.customRules - this.repository.listCustom().length;
    values.forEach((value, index) => {
      if (room <= 0) {
        outcome.skipped.push({ index, issue: LIMIT_MESSAGE });
        return;
      }
      const rule = sanitizeRule(value, this.newId());
      if (isRuleIssue(rule)) {
        outcome.skipped.push({ index, issue: rule.issue });
        return;
      }
      this.repository.save(rule);
      outcome.imported.push(rule);
      room -= 1;
    });
    return outcome;
  }

  private newId(): string {
    return `${CUSTOM_RULE_PREFIX}${this.createId()}`;
  }

  private assertBelowLimit(): void {
    if (this.repository.listCustom().length >= RULE_LIMITS.customRules) {
      throw new RuleError('LIMIT', LIMIT_MESSAGE);
    }
  }

  private requireCustom(id: string): ScanRule {
    if (isBuiltInRuleId(id)) {
      throw new RuleError('BUILT_IN_READ_ONLY', `Built-in rule ${id} cannot be changed`);
    }
    const existing = this.get(id);
    if (!existing) {
      throw new RuleError('NOT_FOUND', `Rule ${id} does not exist`);
    }
    return existing;
  }
}
