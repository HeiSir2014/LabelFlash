import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { STANDARD_TEMPLATE } from '../../core/templates/builtin-templates';
import { sanitizeTemplate } from '../../core/templates/sanitize-template';
import type { TemplateRepository } from '../../core/templates/template-catalog';
import type { LabelTemplate } from '../../core/templates/template-model';
import type { Clock } from '../../core/types';
import { readString } from './row-readers';

/** 自定义模板：每行一个模板，body 是 JSON；读出时重新校验，防止旧数据或手改数据破坏打印。 */
export class SqliteTemplateRepository implements TemplateRepository {
  private readonly selectAll: StatementSync;
  private readonly upsert: StatementSync;
  private readonly deleteById: StatementSync;

  constructor(
    db: DatabaseSync,
    private readonly clock: Clock,
  ) {
    // rowid 是插入顺序（upsert 不会改它），同一毫秒里建的模板也能按创建顺序排。
    this.selectAll = db.prepare('SELECT id, body FROM templates ORDER BY created_at, rowid');
    this.upsert = db.prepare(`
      INSERT INTO templates (id, body, created_at, updated_at) VALUES (:id, :body, :now, :now)
      ON CONFLICT (id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`);
    this.deleteById = db.prepare('DELETE FROM templates WHERE id = :id');
  }

  listCustom(): LabelTemplate[] {
    const templates: LabelTemplate[] = [];
    for (const row of this.selectAll.all()) {
      const id = readString(row, 'id');
      try {
        templates.push(sanitizeTemplate(JSON.parse(readString(row, 'body')), id, STANDARD_TEMPLATE));
      } catch (error) {
        console.error(`[TemplateRepository] template "${id}" is unreadable and was skipped`, error);
      }
    }
    return templates;
  }

  save(template: LabelTemplate): void {
    this.upsert.run({ id: template.id, body: JSON.stringify(template), now: this.clock.now() });
  }

  remove(id: string): void {
    this.deleteById.run({ id });
  }
}
