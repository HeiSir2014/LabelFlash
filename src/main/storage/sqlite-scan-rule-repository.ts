import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { RuleRepository } from '../../core/scan/rule-catalog';
import type { ScanRule } from '../../core/scan/rule-model';
import { isRuleIssue, sanitizeRule } from '../../core/scan/sanitize-rule';
import type { Clock } from '../../core/types';
import { readString } from './row-readers';

/** 自定义识别规则：每行一条规则，body 是 JSON；读出时重新校验，校验不过的跳过并记日志，不让它参与识别。 */
export class SqliteScanRuleRepository implements RuleRepository {
  private readonly selectAll: StatementSync;
  private readonly upsert: StatementSync;
  private readonly deleteById: StatementSync;

  constructor(
    db: DatabaseSync,
    private readonly clock: Clock,
  ) {
    // rowid 是插入顺序（upsert 不会改它），同一毫秒里建的规则也能按创建顺序排。
    this.selectAll = db.prepare('SELECT id, body FROM scan_rules ORDER BY created_at, rowid');
    this.upsert = db.prepare(`
      INSERT INTO scan_rules (id, body, created_at, updated_at) VALUES (:id, :body, :now, :now)
      ON CONFLICT (id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`);
    this.deleteById = db.prepare('DELETE FROM scan_rules WHERE id = :id');
  }

  listCustom(): ScanRule[] {
    const rules: ScanRule[] = [];
    for (const row of this.selectAll.all()) {
      const id = readString(row, 'id');
      try {
        const rule = sanitizeRule(JSON.parse(readString(row, 'body')), id);
        if (isRuleIssue(rule)) {
          console.error(`[ScanRuleRepository] rule "${id}" is invalid and was skipped: ${rule.issue}`);
        } else {
          rules.push(rule);
        }
      } catch (error) {
        console.error(`[ScanRuleRepository] rule "${id}" is unreadable and was skipped`, error);
      }
    }
    return rules;
  }

  save(rule: ScanRule): void {
    this.upsert.run({ id: rule.id, body: JSON.stringify(rule), now: this.clock.now() });
  }

  remove(id: string): void {
    this.deleteById.run({ id });
  }
}
