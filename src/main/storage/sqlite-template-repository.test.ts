import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import { STANDARD_TEMPLATE } from '../../core/templates/builtin-templates';
import { maxQrSizeMm } from '../../core/templates/template-model';
import { FakeClock } from '../../core/testing/fake-clock';
import { openDatabase } from './database';
import { SqliteTemplateRepository } from './sqlite-template-repository';

describe('SqliteTemplateRepository', () => {
  let db: DatabaseSync;
  let clock: FakeClock;
  let repository: SqliteTemplateRepository;

  beforeEach(() => {
    db = openDatabase(':memory:');
    clock = new FakeClock();
    repository = new SqliteTemplateRepository(db, clock);
  });

  afterEach(() => {
    db.close();
  });

  test('saves, updates and lists templates in creation order', () => {
    const first = { ...structuredClone(STANDARD_TEMPLATE), id: 'custom:a', name: '甲' };
    const second = { ...structuredClone(STANDARD_TEMPLATE), id: 'custom:b', name: '乙' };
    repository.save(first);
    clock.advance(1_000);
    repository.save(second);
    clock.advance(1_000);
    repository.save({ ...first, name: '甲（改）' });
    expect(repository.listCustom().map((t) => t.name)).toEqual(['甲（改）', '乙']);
  });

  test('removes a template', () => {
    repository.save({ ...structuredClone(STANDARD_TEMPLATE), id: 'custom:a' });
    repository.remove('custom:a');
    expect(repository.listCustom()).toEqual([]);
  });

  test('re-validates stored bodies and skips unreadable rows', () => {
    db.prepare(
      "INSERT INTO templates (id, body, created_at, updated_at) VALUES ('custom:bad', 'not json', 1, 1)",
    ).run();
    db.prepare(
      'INSERT INTO templates (id, body, created_at, updated_at) VALUES (\'custom:old\', \'{"name":"旧版","qr":{"sizeMm":999}}\', 2, 2)',
    ).run();
    const [only] = repository.listCustom();
    expect(repository.listCustom()).toHaveLength(1);
    expect(only?.name).toBe('旧版');
    expect(only?.qr.sizeMm).toBe(maxQrSizeMm(STANDARD_TEMPLATE.paper, STANDARD_TEMPLATE.paddingMm));
  });

  test('keeps the paper and printer of a template', () => {
    const waybill = {
      ...structuredClone(STANDARD_TEMPLATE),
      id: 'custom:waybill',
      paper: { widthMm: 100, heightMm: 180 },
      printer: '面单机B',
    };
    repository.save(waybill);
    expect(repository.listCustom()[0]).toMatchObject({ paper: { widthMm: 100, heightMm: 180 }, printer: '面单机B' });
  });

  // 1.0.x 存的模板没有纸张和打印机：读出来是 60×40、按纸张分配。
  test('reads a 1.0.x template as 60x40 with no printer of its own', () => {
    db.prepare(
      `INSERT INTO templates (id, body, created_at, updated_at) VALUES ('custom:old', '{"name":"旧版"}', 1, 1)`,
    ).run();
    expect(repository.listCustom()[0]).toMatchObject({ paper: { widthMm: 60, heightMm: 40 }, printer: null });
  });
});
